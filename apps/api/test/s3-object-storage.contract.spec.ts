import { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import {
  S3ObjectStorageAdapter,
  buildS3PutObjectInput,
  validateS3ObjectStorageOptions,
} from '../src/modules/object-storage/adapters/s3/s3-object-storage.adapter';

describe('S3ObjectStorageAdapter configuration/command contract (unit only)', () => {
  it('sets SSE-KMS and never asks for a public ACL', () => {
    const options = validateS3ObjectStorageOptions({
      driver: 's3',
      region: 'us-east-2',
      bucket: 'private-fiscal-objects',
      maxBytes: 5 * 1024 * 1024,
      requestTimeoutMs: 10_000,
      serverSideEncryption: 'aws:kms',
      kmsKeyId: 'alias/balanz-fiscal-objects',
    });
    const command = buildS3PutObjectInput(
      options,
      'objects/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      Readable.from([Buffer.from('payload')]),
      { contentType: 'application/xml', expectedSizeBytes: 7 },
    );

    expect(command).toMatchObject({
      Bucket: 'private-fiscal-objects',
      IfNoneMatch: '*',
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: 'alias/balanz-fiscal-objects',
      ContentType: 'application/xml',
      ContentLength: 7,
    });
    expect(command).not.toHaveProperty('ACL');
  });

  it('supports explicit non-KMS MinIO development configuration', () => {
    const options = validateS3ObjectStorageOptions({
      driver: 's3',
      endpoint: 'http://127.0.0.1:9000',
      allowInsecureEndpoint: true,
      forcePathStyle: true,
      region: 'us-east-1',
      bucket: 'phase0-integration',
      maxBytes: 1024,
      requestTimeoutMs: 10_000,
      serverSideEncryption: 'none',
      signedUrlTtlSeconds: 30,
    });
    const command = buildS3PutObjectInput(
      options,
      'objects/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      Readable.from([Buffer.from('payload')]),
      {},
    );

    expect(options).toMatchObject({
      forcePathStyle: true,
      signedUrlTtlSeconds: 30,
      serverSideEncryption: 'none',
    });
    expect(command).not.toHaveProperty('ServerSideEncryption');
    expect(command).not.toHaveProperty('SSEKMSKeyId');
    expect(command).not.toHaveProperty('ACL');
    expect(command.IfNoneMatch).toBe('*');
  });

  it.each([
    {
      serverSideEncryption: 'aws:kms' as const,
      kmsKeyId: undefined,
    },
    {
      serverSideEncryption: 'AES256' as const,
      kmsKeyId: 'must-not-be-used',
    },
  ])('rejects inconsistent encryption configuration', (encryption) => {
    expectSynchronousCode(
      () =>
        validateS3ObjectStorageOptions({
          driver: 's3',
          region: 'us-east-2',
          bucket: 'private',
          maxBytes: 1024,
          requestTimeoutMs: 10_000,
          ...encryption,
        }),
      'OBJECT_STORAGE_INVALID_CONFIGURATION',
    );
  });

  it('rejects plaintext endpoints unless explicitly allowed for development', () => {
    expectSynchronousCode(
      () =>
        validateS3ObjectStorageOptions({
          driver: 's3',
          endpoint: 'http://minio:9000',
          region: 'us-east-1',
          bucket: 'private',
          maxBytes: 1024,
          requestTimeoutMs: 10_000,
          serverSideEncryption: 'none',
        }),
      'OBJECT_STORAGE_INVALID_CONFIGURATION',
    );
  });

  it('caps signed URLs at five minutes', () => {
    expectSynchronousCode(
      () =>
        validateS3ObjectStorageOptions({
          driver: 's3',
          region: 'us-east-2',
          bucket: 'private',
          maxBytes: 1024,
          requestTimeoutMs: 10_000,
          serverSideEncryption: 'AES256',
          signedUrlTtlSeconds: 301,
        }),
      'OBJECT_STORAGE_INVALID_CONFIGURATION',
    );
  });

  it('validates bounded connection/request timeouts', () => {
    expectSynchronousCode(
      () =>
        validateS3ObjectStorageOptions({
          driver: 's3',
          region: 'us-east-2',
          bucket: 'private',
          maxBytes: 1024,
          serverSideEncryption: 'AES256',
          requestTimeoutMs: 1_000,
          connectionTimeoutMs: 2_000,
        }),
      'OBJECT_STORAGE_INVALID_CONFIGURATION',
    );
  });

  it('rejects a signed URL TTL above its configured maximum before I/O', async () => {
    const adapter = new S3ObjectStorageAdapter({
      driver: 's3',
      region: 'us-east-2',
      bucket: 'private',
      maxBytes: 1024,
      requestTimeoutMs: 10_000,
      serverSideEncryption: 'AES256',
      signedUrlTtlSeconds: 60,
    });
    try {
      await expect(
        adapter.createSignedReadUrl(
          'objects/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          61,
        ),
      ).rejects.toMatchObject({
        code: 'OBJECT_STORAGE_INVALID_CONFIGURATION',
      });
    } finally {
      adapter.onApplicationShutdown();
    }
  });

  it('health verifies encrypted write, metadata, read and cleanup capabilities', async () => {
    const commandNames: string[] = [];
    const send = jest.fn().mockImplementation((command: object) => {
      commandNames.push(command.constructor.name);
      switch (command.constructor.name) {
        case 'HeadObjectCommand':
          return Promise.resolve({
            ContentLength: 6,
            ServerSideEncryption: 'AES256',
          });
        case 'GetObjectCommand':
          return Promise.resolve({
            Body: {
              transformToByteArray: () =>
                Promise.resolve(Buffer.from('health', 'ascii')),
            },
          });
        default:
          return Promise.resolve({});
      }
    });
    const adapter = new S3ObjectStorageAdapter(
      {
        driver: 's3',
        region: 'us-east-2',
        bucket: 'private-health',
        maxBytes: 1024,
        requestTimeoutMs: 10_000,
        serverSideEncryption: 'AES256',
      },
      undefined,
      { send, destroy: jest.fn() } as unknown as S3Client,
    );

    await expect(adapter.health()).resolves.toMatchObject({ status: 'up' });
    expect(commandNames).toEqual([
      'HeadBucketCommand',
      'PutObjectCommand',
      'HeadObjectCommand',
      'GetObjectCommand',
      'DeleteObjectCommand',
    ]);
  });

  it('uses an independent signal and awaits cleanup after the caller aborts', async () => {
    const caller = new AbortController();
    let cleanupSignal: AbortSignal | undefined;
    let finishCleanup: (() => void) | undefined;
    let cleanupStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      cleanupStarted = resolve;
    });
    const send = jest
      .fn()
      .mockImplementation(
        (command: object, options?: { abortSignal?: AbortSignal }) => {
          if (command.constructor.name === 'HeadBucketCommand') {
            caller.abort();
            return Promise.reject(new Error('caller aborted'));
          }
          if (command.constructor.name === 'DeleteObjectCommand') {
            cleanupSignal = options?.abortSignal;
            cleanupStarted?.();
            return new Promise((resolve) => {
              finishCleanup = () => resolve({});
            });
          }
          return Promise.resolve({});
        },
      );
    const adapter = new S3ObjectStorageAdapter(
      {
        driver: 's3',
        region: 'us-east-2',
        bucket: 'private-health',
        maxBytes: 1024,
        requestTimeoutMs: 10_000,
        serverSideEncryption: 'AES256',
      },
      undefined,
      { send, destroy: jest.fn() } as unknown as S3Client,
    );

    const health = adapter.health(caller.signal);
    await started;
    expect(caller.signal.aborted).toBe(true);
    expect(cleanupSignal).toBeDefined();
    expect(cleanupSignal).not.toBe(caller.signal);
    expect(cleanupSignal?.aborted).toBe(false);

    let settled = false;
    void health.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    finishCleanup?.();
    await expect(health).resolves.toMatchObject({ status: 'down' });
  });

  it('aborts and bounds a stalled health cleanup with its own timeout', async () => {
    jest.useFakeTimers();
    let cleanupSignal: AbortSignal | undefined;
    let cleanupStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      cleanupStarted = resolve;
    });
    const send = jest
      .fn()
      .mockImplementation(
        (command: object, options?: { abortSignal?: AbortSignal }) => {
          if (command.constructor.name === 'HeadBucketCommand') {
            return Promise.reject(new Error('provider unavailable'));
          }
          if (command.constructor.name === 'DeleteObjectCommand') {
            cleanupSignal = options?.abortSignal;
            cleanupStarted?.();
            return new Promise((_resolve, reject) => {
              cleanupSignal?.addEventListener(
                'abort',
                () => reject(new Error('cleanup aborted')),
                { once: true },
              );
            });
          }
          return Promise.resolve({});
        },
      );
    const adapter = new S3ObjectStorageAdapter(
      {
        driver: 's3',
        region: 'us-east-2',
        bucket: 'private-health',
        maxBytes: 1024,
        requestTimeoutMs: 25,
        serverSideEncryption: 'AES256',
      },
      undefined,
      { send, destroy: jest.fn() } as unknown as S3Client,
    );

    try {
      const health = adapter.health();
      await started;
      expect(cleanupSignal?.aborted).toBe(false);

      jest.advanceTimersByTime(25);
      await expect(health).resolves.toMatchObject({ status: 'down' });
      expect(cleanupSignal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

function expectSynchronousCode(work: () => unknown, code: string): void {
  try {
    work();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected synchronous error code ${code}`);
}
