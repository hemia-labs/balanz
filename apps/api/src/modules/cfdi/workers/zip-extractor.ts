import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import { zipCrc32 } from './zip-crc32';
import {
  fromRandomAccessReaderPromise,
  RandomAccessReader,
  parseExtraFields,
  type Entry,
  type ZipFile,
} from 'yauzl';
import type { ObjectStoragePort } from '../../object-storage/ports/object-storage.port';
import { DurableWorkerError } from '../../ingestion/workers/worker-error';
import { ZIP_MAX_BYTES } from '../dtos/zip-upload.dtos';

export const ZIP_LIMITS = Object.freeze({
  compressed: ZIP_MAX_BYTES,
  uncompressed: 250 * 1024 * 1024,
  entries: 2000,
  ratio: 50,
  depth: 2,
  path: 240,
});
export interface ArchiveEntry {
  ordinal: number;
  safeFilename: string;
  pathSha256: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  directoryDepth: number;
  xml: boolean;
  metadataText?: boolean;
  entry: Entry;
}
export interface InspectedArchive {
  zip: ZipFile;
  entries: ArchiveEntry[];
  compressedSize: number;
}

/** Does not materialize the archive or use entry names as filesystem paths. */
export class ZipExtractor {
  constructor(
    private readonly storage: ObjectStoragePort,
    private readonly limits: typeof ZIP_LIMITS = ZIP_LIMITS,
  ) {}

  async inspect(
    key: string,
    size: number,
    signal: AbortSignal,
  ): Promise<InspectedArchive> {
    const limits = this.limits;
    if (!Number.isSafeInteger(size) || size < 22 || size > limits.compressed)
      throw zipError('ZIP_LIMIT_EXCEEDED');
    if (!this.storage.openReadRange)
      throw new DurableWorkerError('CONFIGURATION_INVALID', {
        retryable: false,
      });
    let zip: ZipFile | undefined;
    try {
      const tailStart = Math.max(0, size - 65557);
      const tail = await readSmall(this.storage, key, tailStart, size, signal);
      let offset = tail.length - 22;
      while (
        offset >= 0 &&
        (tail.readUInt32LE(offset) !== 0x06054b50 ||
          offset + 22 + tail.readUInt16LE(offset + 20) !== tail.length)
      )
        offset--;
      if (offset < 0) throw zipError();
      const count = tail.readUInt16LE(offset + 10);
      const centralSize = tail.readUInt32LE(offset + 12);
      const centralOffset = tail.readUInt32LE(offset + 16);
      if (
        tail.readUInt16LE(offset + 4) ||
        tail.readUInt16LE(offset + 6) ||
        tail.readUInt16LE(offset + 8) !== count ||
        count === 0xffff ||
        centralOffset + centralSize !== tailStart + offset
      )
        throw zipError();
      if (count > 6000) throw zipError('ZIP_LIMIT_EXCEEDED'); // 2000 files plus at most two directories per file.
      zip = await fromRandomAccessReaderPromise(
        new StorageRangeReader(this.storage, key, size, signal),
        size,
        {
          lazyEntries: true,
          autoClose: false,
          validateEntrySizes: true,
          strictFileNames: false,
        },
      );
      const entries: ArchiveEntry[] = [];
      const all: Array<{
        entry: Entry;
        directory: boolean;
        dataStart: number;
      }> = [];
      const names = new Set<string>();
      let declared = 0;
      let observedCentralSize = 0;
      for await (const entry of zip.eachEntry()) {
        signal.throwIfAborted();
        observedCentralSize +=
          46 +
          entry.fileNameLength +
          entry.extraFieldLength +
          entry.fileCommentLength;
        if (observedCentralSize > centralSize) throw zipError();
        const name = validateZipPath(entry.fileName, limits);
        // Unicode aliases, Windows case aliases and duplicate names are ambiguous.
        const identity = name.path.toLowerCase().replace(/\/$/, '');
        if (names.has(identity)) throw zipError('ZIP_UNSAFE_ENTRY');
        names.add(identity);
        if (
          entry.isEncrypted() ||
          entry.generalPurposeBitFlag & (0x40 | 0x2000)
        )
          throw zipError('ZIP_ENCRYPTED');
        if (
          entry.generalPurposeBitFlag & ~0x080e ||
          ![0, 8].includes(entry.compressionMethod)
        )
          throw zipError('ZIP_UNSAFE_ENTRY');
        validateExtras(entry.extraFieldRaw);
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        const dos = entry.externalFileAttributes & 0xff;
        if (
          (mode && mode !== (name.directory ? 0x4000 : 0x8000)) ||
          dos & 0x08 ||
          (Boolean(dos & 0x10) && !name.directory)
        )
          throw zipError('ZIP_UNSAFE_ENTRY');
        if (/\.zip$/i.test(name.path)) throw zipError('ZIP_NESTED');
        if (name.directory && (entry.uncompressedSize || entry.compressedSize))
          throw zipError('ZIP_UNSAFE_ENTRY');
        if (
          entry.uncompressedSize > limits.uncompressed ||
          entry.uncompressedSize >
            Math.max(1, entry.compressedSize) * limits.ratio
        )
          throw zipError('ZIP_LIMIT_EXCEEDED');
        const local = await zip.readLocalFileHeaderPromise(entry);
        validateExtras(local.extraField);
        if (
          !local.fileName.equals(entry.fileNameRaw) ||
          local.generalPurposeBitFlag !== entry.generalPurposeBitFlag ||
          local.compressionMethod !== entry.compressionMethod ||
          local.versionNeededToExtract !== entry.versionNeededToExtract
        )
          throw zipError();
        if (
          !(entry.generalPurposeBitFlag & 8) &&
          (local.crc32 !== entry.crc32 ||
            local.compressedSize !== entry.compressedSize ||
            local.uncompressedSize !== entry.uncompressedSize)
        )
          throw zipError();
        if (local.fileDataStart + entry.compressedSize > centralOffset)
          throw zipError();
        all.push({
          entry,
          directory: name.directory,
          dataStart: local.fileDataStart,
        });
        if (name.directory) continue;
        if (entries.length >= limits.entries)
          throw zipError('ZIP_LIMIT_EXCEEDED');
        declared += entry.uncompressedSize;
        if (declared > limits.uncompressed || declared > size * limits.ratio)
          throw zipError('ZIP_LIMIT_EXCEEDED');
        const xml = /\.xml$/i.test(name.path);
        entries.push({
          ordinal: entries.length + 1,
          safeFilename: `entrada-${entries.length + 1}${xml ? '.xml' : '.bin'}`,
          pathSha256: createHash('sha256').update(name.path).digest('hex'),
          compressedSize: entry.compressedSize,
          uncompressedSize: entry.uncompressedSize,
          compressionMethod: entry.compressionMethod,
          directoryDepth: name.depth,
          xml,
          metadataText: /\.txt$/i.test(name.path),
          entry,
        });
      }
      if (all.length !== count || observedCentralSize !== centralSize)
        throw zipError();
      // Validate local record boundaries too: no overlaps, gaps, hidden records,
      // prepended executable, or contradictory data descriptors.
      all.sort(
        (a, b) =>
          a.entry.relativeOffsetOfLocalHeader -
          b.entry.relativeOffsetOfLocalHeader,
      );
      let cursor = 0;
      for (const [index, record] of all.entries()) {
        if (record.entry.relativeOffsetOfLocalHeader !== cursor)
          throw zipError();
        cursor = record.dataStart + record.entry.compressedSize;
        const next =
          all[index + 1]?.entry.relativeOffsetOfLocalHeader ?? centralOffset;
        if (record.entry.generalPurposeBitFlag & 8) {
          if (![12, 16].includes(next - cursor)) throw zipError();
          const descriptor = await readSmall(
            this.storage,
            key,
            cursor,
            next,
            signal,
          );
          const start = descriptor.length === 16 ? 4 : 0;
          if (
            (start && descriptor.readUInt32LE(0) !== 0x08074b50) ||
            descriptor.readUInt32LE(start) !== record.entry.crc32 ||
            descriptor.readUInt32LE(start + 4) !==
              record.entry.compressedSize ||
            descriptor.readUInt32LE(start + 8) !== record.entry.uncompressedSize
          )
            throw zipError();
          cursor = next;
        }
        if (cursor !== next) throw zipError();
      }
      if (cursor !== centralOffset) throw zipError();
      if (entries.length === 0) throw zipError('ZIP_EMPTY');
      return { zip, entries, compressedSize: size };
    } catch (error) {
      zip?.close();
      throw classifyZipError(error, signal);
    }
  }

  async extract(
    archive: InspectedArchive,
    signal: AbortSignal,
    consume: (entry: ArchiveEntry, stream: Readable) => Promise<void>,
    boundary: () => Promise<void>,
    keepOpen = false,
  ): Promise<number> {
    const limits = this.limits;
    let total = 0;
    try {
      for (const entry of archive.entries) {
        signal.throwIfAborted();
        await boundary();
        const raw = await archive.zip
          .openReadStreamPromise(entry.entry, {
            decodeFileData: false,
          })
          .catch((error: unknown) => {
            throw classifyZipError(error, signal);
          });
        const inflater =
          entry.compressionMethod === 8 ? createInflateRaw() : undefined;
        const source = inflater ?? raw;
        const pump = inflater
          ? pipeline(raw, inflater, { signal })
          : Promise.resolve();
        void pump.catch(() => undefined);
        let actual = 0;
        let crc = 0;
        let prefix = Buffer.alloc(0);
        const checked = Readable.from(
          (async function* () {
            for await (const chunk of source) {
              signal.throwIfAborted();
              const bytes = Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk as Uint8Array);
              actual += bytes.length;
              total += bytes.length;
              if (actual > entry.uncompressedSize) throw zipError();
              if (
                total > limits.uncompressed ||
                actual > Math.max(1, entry.compressedSize) * limits.ratio ||
                total > archive.compressedSize * limits.ratio
              )
                throw zipError('ZIP_LIMIT_EXCEEDED');
              crc = zipCrc32(bytes, crc);
              if (prefix.length < 4) {
                prefix = Buffer.concat([
                  prefix,
                  bytes.subarray(0, 4 - prefix.length),
                ]);
                if (
                  prefix.length === 4 &&
                  [
                    0x04034b50, 0x06054b50, 0x08074b50, 0x06064b50, 0x07064b50,
                  ].includes(prefix.readUInt32LE(0))
                )
                  throw zipError('ZIP_NESTED');
              }
              yield bytes;
            }
            await pump;
            if (
              actual !== entry.uncompressedSize ||
              crc !== entry.entry.crc32 ||
              (inflater && inflater.bytesWritten !== entry.compressedSize)
            )
              throw zipError();
          })(),
        );
        let streamFailure: Error | undefined;
        checked.once('error', (error) => {
          streamFailure = error;
        });
        try {
          await consume(entry, checked);
          for await (const remaining of checked) void remaining;
        } catch (error) {
          // Consumer failures (including a transient SQL error) are not evidence
          // that the package is corrupt. Only classify failures of the ZIP stream.
          if (streamFailure) throw classifyZipError(streamFailure, signal);
          throw error;
        } finally {
          checked.destroy();
          source.destroy();
          raw.destroy();
          await pump.catch(() => undefined);
        }
      }
      return total;
    } catch (error) {
      if (signal.aborted)
        throw new DurableWorkerError('WORKER_SHUTDOWN', { retryable: true });
      throw error;
    } finally {
      if (!keepOpen) archive.zip.close();
    }
  }
}

export function validateZipPath(
  raw: string,
  limits: typeof ZIP_LIMITS = ZIP_LIMITS,
): {
  path: string;
  directory: boolean;
  depth: number;
} {
  const path = raw.replace(/\\/g, '/').normalize('NFC');
  if (
    !path ||
    path.length > limits.path ||
    path.startsWith('/') ||
    // eslint-disable-next-line no-control-regex -- Security boundary rejects control bytes.
    /[:\x00-\x1f\x7f]/.test(path)
  )
    throw zipError('ZIP_UNSAFE_ENTRY');
  const directory = path.endsWith('/');
  const parts = path.split('/');
  if (directory) parts.pop();
  if (
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part.trim() !== part ||
        /[. ]$/.test(part) ||
        /[<>"|?*]/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    throw zipError('ZIP_UNSAFE_ENTRY');
  const depth = parts.length - (directory ? 0 : 1);
  if (depth > limits.depth) throw zipError('ZIP_LIMIT_EXCEEDED');
  return { path, directory, depth };
}

function validateExtras(raw: Buffer) {
  let length = 0;
  for (const extra of parseExtraFields(raw)) {
    length += 4 + extra.data.length;
    // Timestamp, NTFS timestamps, and UID/GID only. Unix link/device records,
    // ZIP64, encryption and alternate Unicode paths are intentionally rejected.
    if (![0x5455, 0x000a, 0x7875].includes(extra.id))
      throw zipError('ZIP_UNSAFE_ENTRY');
  }
  if (length !== raw.length) throw zipError();
}

class StorageRangeReader extends RandomAccessReader {
  constructor(
    private readonly storage: ObjectStoragePort,
    private readonly key: string,
    private readonly size: number,
    private readonly signal: AbortSignal,
  ) {
    super();
  }
  override _readStreamForRange(start: number, end: number): Readable {
    const target = new PassThrough();
    if (start < 0 || end > this.size || end <= start) {
      queueMicrotask(() => target.destroy(zipError()));
      return target;
    }
    void this.storage.openReadRange!(this.key, start, end, this.signal)
      .then(async (source) => {
        if (target.destroyed) {
          source.destroy();
          return;
        }
        await pipeline(source, target, { signal: this.signal });
      })
      .catch((error: unknown) =>
        target.destroy(error instanceof Error ? error : zipError()),
      );
    return target;
  }
}
async function readSmall(
  storage: ObjectStoragePort,
  key: string,
  start: number,
  end: number,
  signal: AbortSignal,
) {
  const chunks: Buffer[] = [];
  let size = 0;
  const stream = await storage.openReadRange!(key, start, end, signal);
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > end - start) {
      stream.destroy();
      throw zipError();
    }
    chunks.push(bytes);
  }
  if (size !== end - start) throw zipError();
  return Buffer.concat(chunks, size);
}
export function zipError(code = 'ZIP_CORRUPT') {
  return new DurableWorkerError(code, { retryable: false });
}
function classifyZipError(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted)
    return new DurableWorkerError('WORKER_SHUTDOWN', { retryable: true });
  if (error instanceof DurableWorkerError) return error;
  if (
    error instanceof Error &&
    'code' in error &&
    String(error.code).startsWith('OBJECT_STORAGE_')
  )
    return error;
  return zipError();
}
