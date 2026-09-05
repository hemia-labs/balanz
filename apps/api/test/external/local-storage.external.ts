/** Real filesystem integration against a preflighted private development root. */
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { LocalFilesystemObjectStorageAdapter } from '../../src/modules/object-storage/adapters/local-filesystem/local-filesystem-object-storage.adapter';

describe('LocalFilesystemObjectStorageAdapter against a private real root', () => {
  it('streams, hashes, reads and deletes its synthetic object', async () => {
    requireOptIn();
    const payload = Buffer.from('phase-zero-local-storage-fixture', 'utf8');
    const adapter = new LocalFilesystemObjectStorageAdapter({
      driver: 'local',
      rootDirectory: requiredEnvironment('OBJECT_STORAGE_LOCAL_ROOT'),
      maxBytes: 1024,
      keyPrefix: 'integration/objects',
      nodeEnv: 'test',
      windowsPermissionsMode:
        process.platform === 'win32' ? 'presecured-root' : 'reject',
    });
    const objectId = randomUUID();
    const objectKey = `integration/objects/${objectId.slice(0, 2)}/${objectId}`;

    try {
      const stored = await adapter.putStream({
        objectKey,
        body: Readable.from([payload]),
        expectedSizeBytes: payload.length,
      });
      expect(stored).toMatchObject({
        provider: 'local',
        sizeBytes: payload.length,
        sha256: createHash('sha256').update(payload).digest('hex'),
      });
      expect(
        await collect(await adapter.openReadStream(stored.objectKey)),
      ).toEqual(payload);
      await expect(adapter.health()).resolves.toMatchObject({ status: 'up' });
    } finally {
      await adapter.delete(objectKey);
    }
    await expect(adapter.head(objectKey)).resolves.toBeNull();
  });
});

function requireOptIn(): void {
  if (process.env.RUN_LOCAL_STORAGE_INTEGRATION !== 'true') {
    throw new Error('RUN_LOCAL_STORAGE_INTEGRATION=true is required');
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`${name} is required for local storage integration`);
  return value;
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === 'string') chunks.push(Buffer.from(chunk));
    else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
    else throw new Error('Unexpected object-mode chunk from local storage');
  }
  return Buffer.concat(chunks);
}
