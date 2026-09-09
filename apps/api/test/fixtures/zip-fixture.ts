import { deflateRawSync } from 'node:zlib';
import { zipCrc32 } from '../../src/modules/cfdi/workers/zip-crc32';

export interface SyntheticZipEntry {
  name: string;
  body?: Buffer;
  method?: number;
  flags?: number;
  attributes?: number;
  extra?: Buffer;
  declaredSize?: number;
  compressedSuffix?: Buffer;
}
/** Synthetic fixtures are assembled during tests, never committed as large binaries. */
export function makeZip(
  entries: SyntheticZipEntry[],
  comment = Buffer.alloc(0),
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const body = entry.body ?? Buffer.alloc(0);
    const method = entry.method ?? 0;
    const compressed = Buffer.concat([
      method === 8 ? deflateRawSync(body) : body,
      entry.compressedSuffix ?? Buffer.alloc(0),
    ]);
    const flags = entry.flags ?? 0x800;
    const extra = entry.extra ?? Buffer.alloc(0);
    const checksum = zipCrc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.declaredSize ?? body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.declaredSize ?? body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(
      entry.attributes ?? (entry.name.endsWith('/') ? 0x41ed0010 : 0x81a40000),
      38,
    );
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, extra, compressed);
    centrals.push(central, name, extra);
    offset += local.length + name.length + extra.length + compressed.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, central, end, comment]);
}
