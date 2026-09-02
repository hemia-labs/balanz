import { randomUUID } from 'node:crypto';
import {
  constants,
  createWriteStream,
  type Stats,
  type WriteStream,
} from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rmdir,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  parse,
  sep,
} from 'node:path';
import type { Readable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  asObjectStorageError,
  ObjectStorageError,
} from '../../object-storage.errors';
import type {
  ObjectStorageHealth,
  ObjectStorageObjectMetadata,
  ObjectStoragePort,
  ObjectStorageWriteInput,
  ObjectStorageWriteResult,
  SignedObjectReadUrl,
} from '../../ports/object-storage.port';
import { OpaqueObjectKeyFactory } from '../../services/opaque-object-key.factory';
import {
  assertExpectedObjectSize,
  StreamIntegrityTransform,
} from '../../services/stream-integrity';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
export const LOCAL_STORAGE_ROOT_MARKER =
  '.balanz-fiscal-object-storage-root-v1';

export interface LocalFilesystemObjectStorageOptions {
  driver: 'local';
  rootDirectory: string;
  maxBytes: number;
  keyPrefix?: string;
  nodeEnv?: 'development' | 'test' | 'production';
  windowsPermissionsMode?: 'reject' | 'presecured-root';
}

export class LocalFilesystemObjectStorageAdapter implements ObjectStoragePort {
  private readonly configuredRoot: string;
  private readonly maxBytes: number;
  private readonly keyFactory: OpaqueObjectKeyFactory;
  private readonly windowsPresecuredRoot: boolean;

  constructor(
    options: LocalFilesystemObjectStorageOptions,
    keyFactory = new OpaqueObjectKeyFactory(options.keyPrefix),
  ) {
    if (!options.rootDirectory?.trim()) {
      throw new ObjectStorageError(
        'OBJECT_STORAGE_INVALID_CONFIGURATION',
        'A private local object storage root is required',
      );
    }
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
      throw new ObjectStorageError(
        'OBJECT_STORAGE_INVALID_CONFIGURATION',
        'The local object storage byte limit is invalid',
      );
    }

    const nodeEnv = options.nodeEnv ?? 'development';
    this.windowsPresecuredRoot =
      process.platform === 'win32' &&
      options.windowsPermissionsMode === 'presecured-root' &&
      nodeEnv !== 'production';
    if (process.platform === 'win32' && !this.windowsPresecuredRoot) {
      throw new ObjectStorageError(
        'OBJECT_STORAGE_INVALID_CONFIGURATION',
        'Windows local storage requires an explicitly pre-secured private root; use S3 when that external ACL control is unavailable',
      );
    }

    const configuredRoot = resolve(options.rootDirectory);
    this.assertDedicatedRoot(configuredRoot);

    this.configuredRoot = configuredRoot;
    this.maxBytes = options.maxBytes;
    this.keyFactory = keyFactory;
  }

  async putStream(
    input: ObjectStorageWriteInput,
  ): Promise<ObjectStorageWriteResult> {
    assertExpectedObjectSize(input.expectedSizeBytes, this.maxBytes);
    const objectKey = this.keyFactory.assertValid(
      input.objectKey ?? this.keyFactory.create(),
    );
    const { root, targetPath } = await this.resolveObjectPath(objectKey, true);
    const temporaryPath = `${targetPath}.partial-${randomUUID()}`;
    const integrity = new StreamIntegrityTransform(this.maxBytes);
    const destination = createWriteStream(temporaryPath, {
      flags: 'wx',
      mode: FILE_MODE,
    });
    let published = false;

    try {
      await pipeline(
        input.body,
        integrity,
        destination,
        input.signal ? { signal: input.signal } : {},
      );

      if (
        input.expectedSizeBytes !== undefined &&
        integrity.sizeBytes !== input.expectedSizeBytes
      ) {
        throw new ObjectStorageError(
          'OBJECT_STORAGE_SIZE_MISMATCH',
          'The streamed object size does not match the expected size',
        );
      }

      // link() publishes without overwriting an immutable existing object.
      await link(temporaryPath, targetPath);
      published = true;
      await this.enforcePrivateMode(targetPath, FILE_MODE);
      await removeTemporaryFile(temporaryPath, destination);

      return {
        provider: 'local',
        objectKey,
        sizeBytes: integrity.sizeBytes,
        sha256: integrity.digestHex(),
      };
    } catch (error) {
      await removeTemporaryFile(temporaryPath, destination);
      if (published) await removeTemporaryFile(targetPath, destination);
      await this.pruneEmptyParents(root, dirname(targetPath));
      if (!published && systemErrorCode(error) === 'EEXIST') {
        throw new ObjectStorageError(
          'OBJECT_STORAGE_CONFLICT',
          'The immutable object key already exists',
          error instanceof Error ? { cause: error } : undefined,
        );
      }
      throw asObjectStorageError(error);
    }
  }

  async openReadStream(
    objectKey: string,
    signal?: AbortSignal,
  ): Promise<Readable> {
    const { targetPath } = await this.resolveObjectPath(objectKey, false);
    const noFollow = constants.O_NOFOLLOW ?? 0;

    try {
      const file = await open(targetPath, constants.O_RDONLY | noFollow);
      const stats = await file.stat();
      if (!stats.isFile()) {
        await file.close();
        throw new ObjectStorageError(
          'OBJECT_STORAGE_INVALID_KEY',
          'The object key does not identify a regular private file',
        );
      }
      this.assertPrivateMode(stats, FILE_MODE);
      return file.createReadStream({ autoClose: true, signal });
    } catch (error) {
      if (systemErrorCode(error) === 'ENOENT') throw this.notFound(error);
      throw asObjectStorageError(error);
    }
  }

  async head(objectKey: string): Promise<ObjectStorageObjectMetadata | null> {
    const { targetPath } = await this.resolveObjectPath(objectKey, false);
    let stats: Stats;
    try {
      stats = await lstat(targetPath);
    } catch (error) {
      if (systemErrorCode(error) === 'ENOENT') return null;
      throw asObjectStorageError(error);
    }

    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new ObjectStorageError(
        'OBJECT_STORAGE_INVALID_KEY',
        'The object key does not identify a regular private file',
      );
    }
    this.assertPrivateMode(stats, FILE_MODE);

    return {
      provider: 'local',
      objectKey,
      sizeBytes: stats.size,
      lastModifiedAt: stats.mtime,
    };
  }

  async delete(objectKey: string): Promise<void> {
    const { root, targetPath } = await this.resolveObjectPath(objectKey, false);
    try {
      const stats = await lstat(targetPath);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new ObjectStorageError(
          'OBJECT_STORAGE_INVALID_KEY',
          'The object key does not identify a regular private file',
        );
      }
      await unlink(targetPath);
      await this.pruneEmptyParents(root, dirname(targetPath));
    } catch (error) {
      if (systemErrorCode(error) === 'ENOENT') return;
      throw asObjectStorageError(error);
    }
  }

  createSignedReadUrl(
    objectKey: string,
    ttlSeconds?: number,
  ): Promise<SignedObjectReadUrl> {
    void objectKey;
    void ttlSeconds;
    return Promise.reject(
      new ObjectStorageError(
        'OBJECT_STORAGE_UNSUPPORTED_OPERATION',
        'Signed URLs are only available through an object storage provider that supports them',
      ),
    );
  }

  async health(signal?: AbortSignal): Promise<ObjectStorageHealth> {
    const startedAt = Date.now();
    let probePath: string | undefined;
    try {
      signal?.throwIfAborted();
      const root = await this.ensurePrivateRoot();
      signal?.throwIfAborted();
      probePath = resolve(root, `.health-${randomUUID()}`);
      const probe = await open(probePath, 'wx', FILE_MODE);
      try {
        signal?.throwIfAborted();
        await probe.writeFile('ok');
      } finally {
        await probe.close();
      }
      signal?.throwIfAborted();
      await this.enforcePrivateMode(probePath, FILE_MODE);
      await unlink(probePath);
      return {
        status: 'up',
        provider: 'local',
        durationMs: Date.now() - startedAt,
      };
    } catch {
      if (probePath) await unlink(probePath).catch(() => undefined);
      return {
        status: 'down',
        provider: 'local',
        durationMs: Date.now() - startedAt,
        errorCode: 'OBJECT_STORAGE_UNAVAILABLE',
      };
    }
  }

  private async resolveObjectPath(
    objectKey: string,
    createParent: boolean,
  ): Promise<{ root: string; targetPath: string }> {
    const validKey = this.keyFactory.assertValid(objectKey);
    const root = await this.ensurePrivateRoot();
    const targetPath = resolve(root, ...validKey.split('/'));
    this.assertContained(root, targetPath);

    const parent = dirname(targetPath);
    if (createParent) await this.ensureSafeDirectoryTree(root, parent);
    else await this.assertSafeExistingParents(root, parent);

    return { root, targetPath };
  }

  private async ensurePrivateRoot(): Promise<string> {
    if (!this.windowsPresecuredRoot) {
      await mkdir(this.configuredRoot, {
        recursive: true,
        mode: DIRECTORY_MODE,
      });
    }
    let configuredStats: Stats;
    try {
      configuredStats = await lstat(this.configuredRoot);
    } catch (error) {
      if (this.windowsPresecuredRoot && systemErrorCode(error) === 'ENOENT') {
        throw new ObjectStorageError(
          'OBJECT_STORAGE_INVALID_CONFIGURATION',
          'The attested Windows local storage root must already exist with a private inheritable DACL',
        );
      }
      throw error;
    }
    if (configuredStats.isSymbolicLink() || !configuredStats.isDirectory()) {
      throw new ObjectStorageError(
        'OBJECT_STORAGE_INVALID_CONFIGURATION',
        'The local object storage root must be a private directory and not a symbolic link',
      );
    }
    const canonicalRoot = await realpath(this.configuredRoot);
    this.assertDedicatedRoot(canonicalRoot);
    const markerPath = resolve(canonicalRoot, LOCAL_STORAGE_ROOT_MARKER);
    let markerStats: Stats | undefined;
    try {
      markerStats = await lstat(markerPath);
    } catch (error) {
      if (systemErrorCode(error) !== 'ENOENT') throw error;
    }

    if (!markerStats) {
      if (this.windowsPresecuredRoot) {
        throw new ObjectStorageError(
          'OBJECT_STORAGE_INVALID_CONFIGURATION',
          'The attested Windows storage root is missing its private-root marker',
        );
      }
      if ((await readdir(canonicalRoot)).length > 0) {
        throw new ObjectStorageError(
          'OBJECT_STORAGE_INVALID_CONFIGURATION',
          'Refusing to adopt a non-empty unmarked local storage root',
        );
      }
      const marker = await open(markerPath, 'wx', FILE_MODE);
      try {
        await marker.writeFile('balanz-fiscal-object-storage-v1\n');
      } finally {
        await marker.close();
      }
      markerStats = await lstat(markerPath);
    }
    if (markerStats.isSymbolicLink() || !markerStats.isFile()) {
      throw new ObjectStorageError(
        'OBJECT_STORAGE_INVALID_CONFIGURATION',
        'The local storage root marker must be a private regular file',
      );
    }

    await this.enforcePrivateMode(canonicalRoot, DIRECTORY_MODE);
    await this.enforcePrivateMode(markerPath, FILE_MODE);
    return canonicalRoot;
  }

  private assertDedicatedRoot(root: string): void {
    const normalized = resolve(root);
    const filesystemRoot = parse(normalized).root;
    const cwd = resolve(process.cwd());
    const userHome = resolve(homedir());
    const pathSegments = normalized.toLowerCase().split(/[\\/]+/);
    if (
      normalized === filesystemRoot ||
      isSameOrAncestor(normalized, cwd) ||
      normalized === userHome ||
      pathSegments.includes('public')
    ) {
      throw new ObjectStorageError(
        'OBJECT_STORAGE_INVALID_CONFIGURATION',
        'Local object storage requires a dedicated non-public directory and cannot use a filesystem, workspace, cwd, or home root',
      );
    }
  }

  private async ensureSafeDirectoryTree(
    root: string,
    targetDirectory: string,
  ): Promise<void> {
    this.assertContained(root, targetDirectory);
    const pathFromRoot = relative(root, targetDirectory);
    let cursor = root;
    for (const segment of pathFromRoot.split(sep).filter(Boolean)) {
      cursor = resolve(cursor, segment);
      try {
        await mkdir(cursor, { mode: DIRECTORY_MODE });
      } catch (error) {
        if (systemErrorCode(error) !== 'EEXIST') throw error;
      }
      const stats = await lstat(cursor);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new ObjectStorageError(
          'OBJECT_STORAGE_INVALID_KEY',
          'The object key traverses an unsafe directory',
        );
      }
      await this.enforcePrivateMode(cursor, DIRECTORY_MODE);
    }
  }

  private async assertSafeExistingParents(
    root: string,
    targetDirectory: string,
  ): Promise<void> {
    this.assertContained(root, targetDirectory);
    const pathFromRoot = relative(root, targetDirectory);
    let cursor = root;
    for (const segment of pathFromRoot.split(sep).filter(Boolean)) {
      cursor = resolve(cursor, segment);
      try {
        const stats = await lstat(cursor);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw new ObjectStorageError(
            'OBJECT_STORAGE_INVALID_KEY',
            'The object key traverses an unsafe directory',
          );
        }
        this.assertPrivateMode(stats, DIRECTORY_MODE);
      } catch (error) {
        if (systemErrorCode(error) === 'ENOENT') return;
        throw error;
      }
    }
  }

  private assertContained(root: string, targetPath: string): void {
    const pathFromRoot = relative(root, targetPath);
    if (
      pathFromRoot.length === 0 ||
      pathFromRoot === '..' ||
      pathFromRoot.startsWith(`..${sep}`) ||
      isAbsolute(pathFromRoot) ||
      basename(targetPath).length === 0
    ) {
      throw new ObjectStorageError(
        'OBJECT_STORAGE_INVALID_KEY',
        'The object key escapes the configured private storage root',
      );
    }
  }

  private async pruneEmptyParents(root: string, start: string): Promise<void> {
    let cursor = start;
    while (cursor !== root) {
      this.assertContained(root, resolve(cursor, '.prune-sentinel'));
      try {
        const stats = await lstat(cursor);
        if (stats.isSymbolicLink() || !stats.isDirectory()) return;
        await rmdir(cursor);
      } catch (error) {
        const code = systemErrorCode(error);
        if (code === 'ENOENT') {
          cursor = dirname(cursor);
          continue;
        }
        if (code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'EPERM') {
          return;
        }
        throw error;
      }
      cursor = dirname(cursor);
    }
  }

  private async enforcePrivateMode(
    path: string,
    expectedMode: number,
  ): Promise<void> {
    if (this.windowsPresecuredRoot) return;
    await chmod(path, expectedMode);
    this.assertPrivateMode(await lstat(path), expectedMode);
  }

  private assertPrivateMode(stats: Stats, expectedMode: number): void {
    if (this.windowsPresecuredRoot) return;
    if ((stats.mode & 0o777) !== expectedMode) {
      throw new ObjectStorageError(
        'OBJECT_STORAGE_INVALID_CONFIGURATION',
        'Local object storage permissions are not private',
      );
    }
  }

  private notFound(cause: unknown): ObjectStorageError {
    return new ObjectStorageError(
      'OBJECT_STORAGE_NOT_FOUND',
      'The private object was not found',
      cause instanceof Error ? { cause } : undefined,
    );
  }
}

async function removeTemporaryFile(
  temporaryPath: string,
  destination: WriteStream,
): Promise<void> {
  if (!destination.closed) {
    destination.destroy();
    await finished(destination).catch(() => undefined);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await unlink(temporaryPath);
      return;
    } catch (error) {
      const code = systemErrorCode(error);
      if (code === 'ENOENT') return;
      if (code !== 'EPERM' || attempt === 4) throw error;
      await delay(10 * (attempt + 1));
    }
  }
}

function systemErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function isSameOrAncestor(candidate: string, target: string): boolean {
  const pathFromCandidate = relative(candidate, target);
  return (
    pathFromCandidate.length === 0 ||
    (pathFromCandidate !== '..' &&
      !pathFromCandidate.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromCandidate))
  );
}
