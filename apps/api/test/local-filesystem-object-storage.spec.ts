import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { Readable } from 'node:stream';
import {
  LOCAL_STORAGE_ROOT_MARKER,
  LocalFilesystemObjectStorageAdapter,
} from '../src/modules/object-storage/adapters/local-filesystem/local-filesystem-object-storage.adapter';

describe('LocalFilesystemObjectStorageAdapter integration', () => {
  let temporaryDirectory: string;
  let storageRoot: string;
  let adapter: LocalFilesystemObjectStorageAdapter;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'balanz-storage-test-'));
    storageRoot = join(temporaryDirectory, 'private-objects');
    await mkdir(storageRoot);
    if (process.platform === 'win32') {
      await writeFile(
        join(storageRoot, LOCAL_STORAGE_ROOT_MARKER),
        'balanz-fiscal-object-storage-v1\n',
      );
    }
    adapter = new LocalFilesystemObjectStorageAdapter({
      driver: 'local',
      rootDirectory: storageRoot,
      keyPrefix: 'test/objects',
      maxBytes: 1024,
      nodeEnv: 'test',
      windowsPermissionsMode:
        process.platform === 'win32' ? 'presecured-root' : 'reject',
    });
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('streams immutable bytes, calculates size/hash, reads and deletes', async () => {
    const payload = Buffer.from('contenido fiscal sintetico\n', 'utf8');
    const result = await adapter.putStream({
      body: Readable.from([payload.subarray(0, 8), payload.subarray(8)]),
      expectedSizeBytes: payload.length,
      contentType: 'application/xml',
    });

    expect(result).toMatchObject({
      provider: 'local',
      sizeBytes: payload.length,
      sha256: createHash('sha256').update(payload).digest('hex'),
    });
    expect(result.objectKey).toMatch(/^test\/objects\//);

    const stream = await adapter.openReadStream(result.objectKey);
    expect(await collect(stream)).toEqual(payload);
    await expect(adapter.head(result.objectKey)).resolves.toMatchObject({
      provider: 'local',
      objectKey: result.objectKey,
      sizeBytes: payload.length,
    });
    await adapter.delete(result.objectKey);
    await expect(adapter.head(result.objectKey)).resolves.toBeNull();
    await expect(adapter.delete(result.objectKey)).resolves.toBeUndefined();
  });

  it('never overwrites an immutable existing key', async () => {
    const first = await adapter.putStream({
      body: Readable.from([Buffer.from('first')]),
    });

    await expect(
      adapter.putStream({
        objectKey: first.objectKey,
        body: Readable.from([Buffer.from('second')]),
      }),
    ).rejects.toMatchObject({ code: 'OBJECT_STORAGE_CONFLICT' });

    expect(
      await collect(await adapter.openReadStream(first.objectKey)),
    ).toEqual(Buffer.from('first'));
  });

  it('rejects traversal before touching a path outside the root', async () => {
    await expect(adapter.openReadStream('../outside')).rejects.toMatchObject({
      code: 'OBJECT_STORAGE_INVALID_KEY',
    });
    await expect(adapter.delete('/absolute/path')).rejects.toMatchObject({
      code: 'OBJECT_STORAGE_INVALID_KEY',
    });
  });

  it('enforces the byte limit and removes partial files', async () => {
    await expect(
      adapter.putStream({
        body: Readable.from([Buffer.alloc(1025, 1)]),
      }),
    ).rejects.toMatchObject({ code: 'OBJECT_STORAGE_LIMIT_EXCEEDED' });

    expect(
      (await readdir(storageRoot, { recursive: true })).filter(isFileName),
    ).toEqual([]);
  });

  it('rejects a detected size mismatch and removes partial files', async () => {
    await expect(
      adapter.putStream({
        body: Readable.from([Buffer.from('1234')]),
        expectedSizeBytes: 5,
      }),
    ).rejects.toMatchObject({ code: 'OBJECT_STORAGE_SIZE_MISMATCH' });

    expect(
      (await readdir(storageRoot, { recursive: true })).filter(isFileName),
    ).toEqual([]);
  });

  it('cleans partial files when an upload is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.putStream({
        body: Readable.from([Buffer.from('never-persist')]),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'OBJECT_STORAGE_UNAVAILABLE' });
    expect(
      (await readdir(storageRoot, { recursive: true })).filter(isFileName),
    ).toEqual([]);
  });

  it('uses restrictive POSIX modes when the platform supports them', async () => {
    if (process.platform === 'win32') return;
    const result = await adapter.putStream({
      body: Readable.from([Buffer.from('private')]),
    });
    const path = join(storageRoot, ...result.objectKey.split('/'));

    expect((await stat(storageRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('rejects un-attested Windows roots instead of treating chmod as an ACL', () => {
    if (process.platform !== 'win32') return;
    expectSynchronousCode(
      () =>
        new LocalFilesystemObjectStorageAdapter({
          driver: 'local',
          rootDirectory: storageRoot,
          maxBytes: 1024,
          nodeEnv: 'test',
        }),
      'OBJECT_STORAGE_INVALID_CONFIGURATION',
    );
  });

  it('does not create a Windows root merely because it was declared pre-secured', async () => {
    if (process.platform !== 'win32') return;
    await rm(storageRoot, { recursive: true });
    const attested = new LocalFilesystemObjectStorageAdapter({
      driver: 'local',
      rootDirectory: storageRoot,
      maxBytes: 1024,
      nodeEnv: 'test',
      windowsPermissionsMode: 'presecured-root',
    });

    await expect(attested.health()).resolves.toMatchObject({ status: 'down' });
    await expect(stat(storageRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('provides a write/read/delete health probe without leaving objects', async () => {
    await expect(adapter.health()).resolves.toMatchObject({
      status: 'up',
      provider: 'local',
    });
    expect(await readdir(storageRoot)).toEqual([LOCAL_STORAGE_ROOT_MARKER]);
  });

  it('does not fabricate signed filesystem URLs', async () => {
    await expect(
      adapter.createSignedReadUrl(
        'test/objects/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
    ).rejects.toMatchObject({
      code: 'OBJECT_STORAGE_UNSUPPORTED_OPERATION',
    });
  });

  it('rejects a root below a public directory', () => {
    expectSynchronousCode(
      () =>
        new LocalFilesystemObjectStorageAdapter({
          driver: 'local',
          rootDirectory: join(temporaryDirectory, 'public', 'objects'),
          maxBytes: 1024,
        }),
      'OBJECT_STORAGE_INVALID_CONFIGURATION',
    );
  });

  it.each([
    ['filesystem root', parse(process.cwd()).root],
    ['current working directory', process.cwd()],
  ])('rejects an unsafe %s as the storage root', (_name, rootDirectory) => {
    expectSynchronousCode(
      () =>
        new LocalFilesystemObjectStorageAdapter({
          driver: 'local',
          rootDirectory,
          maxBytes: 1024,
          nodeEnv: 'test',
          windowsPermissionsMode:
            process.platform === 'win32' ? 'presecured-root' : 'reject',
        }),
      'OBJECT_STORAGE_INVALID_CONFIGURATION',
    );
  });
});

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(readableChunkToBuffer(chunk));
  return Buffer.concat(chunks);
}

function readableChunkToBuffer(value: unknown): Buffer {
  if (typeof value === 'string') return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new Error('Unexpected object-mode chunk');
}

function expectSynchronousCode(work: () => unknown, code: string): void {
  try {
    work();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected synchronous error code ${code}`);
}

function isFileName(value: string | Buffer): boolean {
  return (
    !String(value).endsWith('objects') &&
    /partial|[0-9a-f-]{36}$/.test(String(value))
  );
}
