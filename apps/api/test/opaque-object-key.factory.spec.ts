import { OpaqueObjectKeyFactory } from '../src/modules/object-storage/services/opaque-object-key.factory';

describe('OpaqueObjectKeyFactory', () => {
  it('creates unique opaque keys with no business data', () => {
    const factory = new OpaqueObjectKeyFactory('balanz/dev/objects');
    const keys = new Set(Array.from({ length: 100 }, () => factory.create()));

    expect(keys.size).toBe(100);
    for (const key of keys) {
      expect(factory.assertValid(key)).toBe(key);
      expect(key).toMatch(/^balanz\/dev\/objects\/[0-9a-f]{2}\/[0-9a-f-]{36}$/);
      expect(key).not.toContain('RFC');
      expect(key).not.toContain('cliente');
      expect(key).not.toContain('.xml');
    }
  });

  it.each([
    '../outside',
    '/absolute/path',
    'objects/../550e8400-e29b-41d4-a716-446655440000',
    'objects\\aa\\550e8400-e29b-41d4-a716-446655440000',
    'objects/aa/not-a-uuid',
    'other/aa/550e8400-e29b-41d4-a716-446655440000',
  ])('rejects a caller-controlled key: %s', (key) => {
    const factory = new OpaqueObjectKeyFactory();
    expectSynchronousCode(
      () => factory.assertValid(key),
      'OBJECT_STORAGE_INVALID_KEY',
    );
  });

  it.each([
    '../objects',
    '/objects',
    'objects/../../escape',
    'Objects/invalid space',
  ])('rejects an unsafe configured prefix: %s', (prefix) => {
    expectSynchronousCode(
      () => new OpaqueObjectKeyFactory(prefix),
      'OBJECT_STORAGE_INVALID_CONFIGURATION',
    );
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
