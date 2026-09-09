import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import {
  ZipExtractor,
  validateZipPath,
  ZIP_LIMITS,
} from '../src/modules/cfdi/workers/zip-extractor';
import type { ObjectStoragePort } from '../src/modules/object-storage/ports/object-storage.port';
import { makeZip } from './fixtures/zip-fixture';
import {
  portableZipCrc32,
  zipCrc32,
} from '../src/modules/cfdi/workers/zip-crc32';

function setup(bytes: Buffer) {
  const ranges: number[] = [];
  const storage = {
    openReadRange: jest.fn((_key: string, start: number, end: number) => {
      ranges.push(end - start);
      return Promise.resolve(
        Readable.from(
          (function* () {
            for (let i = start; i < end; i += 16384)
              yield bytes.subarray(i, Math.min(i + 16384, end));
          })(),
        ),
      );
    }),
  } as unknown as ObjectStoragePort;
  return { extractor: new ZipExtractor(storage), ranges };
}
async function extract(bytes: Buffer) {
  const { extractor, ranges } = setup(bytes);
  const signal = new AbortController().signal;
  const archive = await extractor.inspect('opaque', bytes.length, signal);
  const results: Array<{ ordinal: number; xml: boolean; bytes: number }> = [];
  const total = await extractor.extract(
    archive,
    signal,
    async (entry, stream) => {
      let count = 0;
      for await (const chunk of stream) count += (chunk as Buffer).length;
      results.push({ ordinal: entry.ordinal, xml: entry.xml, bytes: count });
    },
    () => Promise.resolve(),
  );
  return { total, results, ranges };
}
describe('ZIP streaming security boundary', () => {
  it.each([{ entries: [] }, { entries: [{ name: 'a/' }, { name: 'a/b/' }] }])(
    'rejects archives without regular files: %j',
    async ({ entries }) => {
      await expect(extract(makeZip(entries))).rejects.toMatchObject({
        code: 'ZIP_EMPTY',
        retryable: false,
      });
    },
  );
  it('keeps incremental CRC compatible with Node 20 and the IEEE reference vector', () => {
    const first = Buffer.from('1234'),
      second = Buffer.from('56789');
    expect(portableZipCrc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(portableZipCrc32(second, portableZipCrc32(first))).toBe(0xcbf43926);
    const bytes = randomBytes(8192);
    expect(portableZipCrc32(bytes)).toBe(zipCrc32(bytes));
  });
  it('extracts multiple XML and a regular unsupported file, ignoring folders', async () => {
    const result = await extract(
      makeZip([
        { name: 'a/' },
        { name: 'a/uno.xml', body: Buffer.from('<x/>') },
        { name: 'dos.XML', body: Buffer.from('<y/>'), method: 8 },
        { name: 'nota.txt', body: Buffer.from('ok') },
      ]),
    );
    expect(result.results).toEqual([
      { ordinal: 1, xml: true, bytes: 4 },
      { ordinal: 2, xml: true, bytes: 4 },
      { ordinal: 3, xml: false, bytes: 2 },
    ]);
    expect(result.total).toBe(10);
  });
  it('accepts 2000 regular entries', async () => {
    expect(
      (
        await extract(
          makeZip(
            Array.from({ length: 2000 }, (_, i) => ({
              name: `${i}.xml`,
              body: Buffer.from('<x/>'),
            })),
          ),
        )
      ).results,
    ).toHaveLength(2000);
  });
  it('rejects 2001 regular entries including non-XML', async () => {
    await expect(
      extract(
        makeZip(Array.from({ length: 2001 }, (_, i) => ({ name: `${i}.txt` }))),
      ),
    ).rejects.toMatchObject({ code: 'ZIP_LIMIT_EXCEEDED' });
  });
  it.each([
    '../x.xml',
    'a/../x.xml',
    '..\\x.xml',
    'a\\..\\x.xml',
    '/x.xml',
    'C:/x.xml',
    'C:x.xml',
    '\\\\host\\x.xml',
    '//host/x.xml',
    'a//x.xml',
    'a/./x.xml',
    'a/ /x.xml',
    'a/x.xml.',
    'NUL.xml',
    'a/x:stream.xml',
    '',
  ])('rejects unsafe path %s', (name) => {
    expect(() => validateZipPath(name)).toThrow();
  });
  it('normalizes benign Windows separators and permits two directories', () => {
    expect(validateZipPath('a\\b\\x.xml').depth).toBe(2);
  });
  it('rejects third directory level', async () => {
    await expect(
      extract(makeZip([{ name: 'a/b/c/x.xml' }])),
    ).rejects.toMatchObject({ code: 'ZIP_LIMIT_EXCEEDED' });
  });
  it('enforces 240-character path maximum', () => {
    expect(() => validateZipPath('a'.repeat(237) + '.xml')).toThrow();
    expect(validateZipPath('a'.repeat(236) + '.xml').depth).toBe(0);
  });
  it.each([0xa1ff0000, 0x21ff0000, 0x61ff0000, 0x11ff0000, 0xc1ff0000])(
    'rejects link/device/special mode %i',
    async (attributes) => {
      await expect(
        extract(makeZip([{ name: 'x.xml', attributes }])),
      ).rejects.toMatchObject({ code: 'ZIP_UNSAFE_ENTRY' });
    },
  );
  it('rejects Unix hardlink extra fields', async () => {
    const extra = Buffer.from([0x0d, 0, 0, 0]);
    await expect(
      extract(makeZip([{ name: 'x.xml', extra }])),
    ).rejects.toMatchObject({ code: 'ZIP_UNSAFE_ENTRY' });
  });
  it('rejects encryption before extraction', async () => {
    await expect(
      extract(makeZip([{ name: 'x.xml', flags: 0x801, method: 8 }])),
    ).rejects.toMatchObject({ code: 'ZIP_ENCRYPTED' });
  });
  it('rejects named nested ZIP', async () => {
    await expect(
      extract(makeZip([{ name: 'other.zip' }])),
    ).rejects.toMatchObject({ code: 'ZIP_NESTED' });
  });
  it('rejects disguised nested ZIP bytes', async () => {
    await expect(
      extract(makeZip([{ name: 'x.xml', body: makeZip([]) }])),
    ).rejects.toMatchObject({ code: 'ZIP_NESTED' });
  });
  it('rejects ratio above 50', async () => {
    await expect(
      extract(
        makeZip([{ name: 'x.xml', body: Buffer.alloc(100000), method: 8 }]),
      ),
    ).rejects.toMatchObject({ code: 'ZIP_LIMIT_EXCEEDED' });
  });
  it('accepts exactly 50 MiB compressed input without a whole archive read', async () => {
    const overhead = makeZip([{ name: 'x.bin' }]).length;
    const bytes = makeZip([
      {
        name: 'x.bin',
        body: Buffer.alloc(ZIP_LIMITS.compressed - overhead, 0x61),
      },
    ]);
    const result = await extract(bytes);
    expect(bytes.length).toBe(ZIP_LIMITS.compressed);
    expect(result.total).toBe(ZIP_LIMITS.compressed - overhead);
    expect(Math.max(...result.ranges)).toBeLessThan(bytes.length);
  });
  it('rejects over 50 MiB before storage access', async () => {
    await expect(
      setup(Buffer.alloc(0)).extractor.inspect(
        'opaque',
        ZIP_LIMITS.compressed + 1,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'ZIP_LIMIT_EXCEEDED' });
  });
  it('enforces cumulative 250 MiB at header inspection', async () => {
    // Legitimate ratio < 50 while sharing generated test data; no huge fixture in Git.
    const block = randomBytes(24576);
    const body = Buffer.concat(Array(43).fill(block) as Buffer[]).subarray(
      0,
      1024 * 1024,
    );
    await expect(
      extract(
        makeZip(
          Array.from({ length: 251 }, (_, i) => ({
            name: `${i}.bin`,
            body,
            method: 8,
          })),
        ),
      ),
    ).rejects.toMatchObject({ code: 'ZIP_LIMIT_EXCEEDED' });
  }, 30000);
  it('streams exactly 250 MiB accumulated across regular entries', async () => {
    const block = randomBytes(24576);
    const body = Buffer.concat(Array(43).fill(block) as Buffer[]).subarray(
      0,
      1024 * 1024,
    );
    const result = await extract(
      makeZip(
        Array.from({ length: 250 }, (_, i) => ({
          name: `${i}.bin`,
          body,
          method: 8,
        })),
      ),
    );
    expect(result.total).toBe(ZIP_LIMITS.uncompressed);
    expect(result.results).toHaveLength(250);
  }, 30000);
  it('rejects padding after the actual deflate stream', async () => {
    await expect(
      extract(
        makeZip([
          {
            name: 'x.xml',
            body: Buffer.from('<x/>'),
            method: 8,
            compressedSuffix: Buffer.from('padding'),
          },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'ZIP_CORRUPT' });
  });
  it('does not classify a consumer database failure as corrupt ZIP', async () => {
    const bytes = makeZip([{ name: 'a.xml', body: Buffer.from('<x/>') }]);
    const { extractor } = setup(bytes);
    const signal = new AbortController().signal;
    const archive = await extractor.inspect('opaque', bytes.length, signal);
    const failure = Object.assign(new Error('database unavailable'), {
      code: '08006',
    });
    await expect(
      extractor.extract(
        archive,
        signal,
        async (_entry, stream) => {
          for await (const chunk of stream) void chunk;
          throw failure;
        },
        () => Promise.resolve(),
      ),
    ).rejects.toBe(failure);
  });
  it('rejects inconsistent local versus central sizes', async () => {
    const zip = makeZip([{ name: 'x.xml', body: Buffer.from('<x/>') }]);
    zip.writeUInt32LE(3, 22);
    await expect(extract(zip)).rejects.toMatchObject({ code: 'ZIP_CORRUPT' });
  });
  it('rejects actual inflated bytes beyond declared size', async () => {
    await expect(
      extract(
        makeZip([
          {
            name: 'x.xml',
            body: Buffer.from('abcdef'),
            method: 8,
            declaredSize: 3,
          },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'ZIP_CORRUPT' });
  });
  it('rejects CRC mismatch', async () => {
    const zip = makeZip([{ name: 'x.xml', body: Buffer.from('<x/>') }]);
    zip[35] ^= 1;
    await expect(extract(zip)).rejects.toMatchObject({ code: 'ZIP_CORRUPT' });
  });
  it('rejects truncation', async () => {
    const zip = makeZip([{ name: 'x.xml' }]);
    await expect(
      extract(zip.subarray(0, zip.length - 4)),
    ).rejects.toMatchObject({ code: 'ZIP_CORRUPT' });
  });
  it('rejects corrupt central directory', async () => {
    const zip = makeZip([{ name: 'x.xml' }]);
    zip[35] = 0;
    await expect(extract(zip)).rejects.toMatchObject({ code: 'ZIP_CORRUPT' });
  });
  it('checks cancellation between entries', async () => {
    const bytes = makeZip([{ name: 'a.xml' }, { name: 'b.xml' }]);
    const { extractor } = setup(bytes);
    const controller = new AbortController();
    const archive = await extractor.inspect(
      'opaque',
      bytes.length,
      controller.signal,
    );
    let seen = 0;
    await expect(
      extractor.extract(
        archive,
        controller.signal,
        async (_entry, stream) => {
          for await (const chunk of stream) void chunk;
          seen++;
          controller.abort();
        },
        () => Promise.resolve(),
      ),
    ).rejects.toMatchObject({ code: 'WORKER_SHUTDOWN' });
    expect(seen).toBe(1);
  });
});
