/**
 * Real MinIO/S3 integration suite. This file is intentionally outside the
 * default Jest pattern: execute it explicitly only with a private test bucket.
 * It uses no mocked transport and deletes every generated object in finally.
 */
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { S3ObjectStorageAdapter } from '../../src/modules/object-storage/adapters/s3/s3-object-storage.adapter';

describe('S3ObjectStorageAdapter against real MinIO/S3', () => {
  it('round-trips a private object, signs a short URL and cleans up', async () => {
    requireOptIn('RUN_MINIO_INTEGRATION');
    const endpoint = requiredEnvironment('S3_ENDPOINT');
    const bucket = requiredEnvironment('S3_BUCKET');
    const encryption = integrationEncryption();
    const inspector = createInspector();
    const payload = Buffer.from('phase-zero-real-minio-object', 'utf8');
    const objectId = randomUUID();
    const objectKey = `integration/objects/${objectId.slice(0, 2)}/${objectId}`;
    const adapter = new S3ObjectStorageAdapter({
      driver: 's3',
      endpoint,
      allowInsecureEndpoint: process.env.S3_ALLOW_INSECURE === 'true',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      region: requiredEnvironment('S3_REGION'),
      bucket,
      maxBytes: 5 * 1024 * 1024,
      requestTimeoutMs: Number(process.env.S3_REQUEST_TIMEOUT_MS ?? 10_000),
      keyPrefix: 'integration/objects',
      credentials: {
        accessKeyId: requiredEnvironment('S3_ACCESS_KEY_ID'),
        secretAccessKey: requiredEnvironment('S3_SECRET_ACCESS_KEY'),
      },
      serverSideEncryption: encryption,
      kmsKeyId:
        encryption === 'aws:kms'
          ? requiredEnvironment('S3_KMS_KEY_ID')
          : undefined,
      signedUrlTtlSeconds: 30,
    });

    try {
      const stored = await adapter.putStream({
        objectKey,
        body: Readable.from([payload]),
        expectedSizeBytes: payload.length,
        contentType: 'application/octet-stream',
      });
      await expect(adapter.health()).resolves.toMatchObject({ status: 'up' });
      await expect(adapter.head(stored.objectKey)).resolves.toMatchObject({
        sizeBytes: payload.length,
      });
      await expect(
        inspector.send(
          new HeadObjectCommand({ Bucket: bucket, Key: stored.objectKey }),
        ),
      ).resolves.toMatchObject({ ServerSideEncryption: encryption });
      expect(
        await collect(await adapter.openReadStream(stored.objectKey)),
      ).toEqual(payload);

      const signed = await adapter.createSignedReadUrl(stored.objectKey, 30);
      const signedResponse = await fetch(signed.url);
      expect(signedResponse.status).toBe(200);
      expect(Buffer.from(await signedResponse.arrayBuffer())).toEqual(payload);

      const unsignedUrl = `${endpoint.replace(/\/$/, '')}/${bucket}/${stored.objectKey}`;
      const unsignedResponse = await fetch(unsignedUrl);
      expect([401, 403, 404]).toContain(unsignedResponse.status);
    } finally {
      try {
        await adapter.delete(objectKey);
        expect(await adapter.head(objectKey)).toBeNull();
      } finally {
        adapter.onApplicationShutdown();
        inspector.destroy();
      }
    }
  });

  it('atomically rejects racing multipart writes to an immutable key', async () => {
    requireOptIn('RUN_MINIO_INTEGRATION');
    const adapter = createAdapter(8 * 1024 * 1024);
    const objectId = randomUUID();
    const objectKey = `integration/objects/${objectId.slice(0, 2)}/${objectId}`;
    const firstPayload = Buffer.alloc(6 * 1024 * 1024, 0x31);
    const secondPayload = Buffer.alloc(6 * 1024 * 1024, 0x32);

    try {
      const attempts = await Promise.allSettled([
        adapter.putStream({
          objectKey,
          body: Readable.from([firstPayload]),
          expectedSizeBytes: firstPayload.length,
        }),
        adapter.putStream({
          objectKey,
          body: Readable.from([secondPayload]),
          expectedSizeBytes: secondPayload.length,
        }),
      ]);
      expect(
        attempts.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = attempts.find(({ status }) => status === 'rejected');
      expect(rejected).toMatchObject({
        status: 'rejected',
        reason: { code: 'OBJECT_STORAGE_CONFLICT' },
      });

      const persisted = await collect(await adapter.openReadStream(objectKey));
      expect(
        persisted.equals(firstPayload) || persisted.equals(secondPayload),
      ).toBe(true);
    } finally {
      await adapter.delete(objectKey).catch(() => undefined);
      adapter.onApplicationShutdown();
    }
  });
});

function createAdapter(maxBytes: number): S3ObjectStorageAdapter {
  const encryption = integrationEncryption();
  return new S3ObjectStorageAdapter({
    driver: 's3',
    endpoint: requiredEnvironment('S3_ENDPOINT'),
    allowInsecureEndpoint: process.env.S3_ALLOW_INSECURE === 'true',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    region: requiredEnvironment('S3_REGION'),
    bucket: requiredEnvironment('S3_BUCKET'),
    maxBytes,
    requestTimeoutMs: Number(process.env.S3_REQUEST_TIMEOUT_MS ?? 10_000),
    keyPrefix: 'integration/objects',
    credentials: {
      accessKeyId: requiredEnvironment('S3_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnvironment('S3_SECRET_ACCESS_KEY'),
    },
    serverSideEncryption: encryption,
    kmsKeyId:
      encryption === 'aws:kms'
        ? requiredEnvironment('S3_KMS_KEY_ID')
        : undefined,
    signedUrlTtlSeconds: 30,
    multipartPartSizeBytes: 5 * 1024 * 1024,
  });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for real MinIO integration`);
  return value;
}

function requireOptIn(name: string): void {
  if (process.env[name] !== 'true') {
    throw new Error(
      `${name}=true is required for this external integration suite`,
    );
  }
}

function integrationEncryption(): 'AES256' | 'aws:kms' {
  const value = process.env.S3_SSE_MODE || 'AES256';
  if (value === 'AES256' || value === 'aws:kms') {
    return value;
  }
  throw new Error(
    'Real MinIO/S3 integration requires S3_SSE_MODE=AES256 or aws:kms',
  );
}

function createInspector(): S3Client {
  return new S3Client({
    endpoint: requiredEnvironment('S3_ENDPOINT'),
    region: requiredEnvironment('S3_REGION'),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: requiredEnvironment('S3_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnvironment('S3_SECRET_ACCESS_KEY'),
    },
  });
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === 'string') chunks.push(Buffer.from(chunk));
    else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
    else throw new Error('Unexpected object-mode chunk from S3');
  }
  return Buffer.concat(chunks);
}
