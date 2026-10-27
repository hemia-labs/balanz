import { crc32 as nativeCrc32 } from 'node:zlib';

// Node 20 remains supported by this repository but has no zlib.crc32.
// IEEE CRC-32 is an archive integrity check; SHA-256 remains the object identity.
const table = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++)
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
export function portableZipCrc32(bytes: Uint8Array, previous = 0): number {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (let index = 0; index < bytes.length; index++)
    crc = table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipCrc32(bytes: Uint8Array, previous = 0): number {
  return typeof nativeCrc32 === 'function'
    ? nativeCrc32(bytes, previous)
    : portableZipCrc32(bytes, previous);
}
