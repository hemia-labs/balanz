import { Readable } from 'node:stream';
import { DevelopmentBypassScannerAdapter } from '../src/modules/malware-scanner/adapters/development-bypass/development-bypass-scanner.adapter';

describe('DevelopmentBypassScannerAdapter', () => {
  it('requires an explicit development-only opt-in', () => {
    expectSynchronousCode(
      () =>
        new DevelopmentBypassScannerAdapter({
          driver: 'development-bypass',
          nodeEnv: 'production',
          explicitlyEnabled: true,
          maxBytes: 1024,
        }),
      'MALWARE_SCANNER_INVALID_CONFIGURATION',
    );
    expectSynchronousCode(
      () =>
        new DevelopmentBypassScannerAdapter({
          driver: 'development-bypass',
          nodeEnv: 'development',
          explicitlyEnabled: false,
          maxBytes: 1024,
        }),
      'MALWARE_SCANNER_INVALID_CONFIGURATION',
    );
  });

  it('reports bypass explicitly and still consumes/enforces the stream', async () => {
    const adapter = new DevelopmentBypassScannerAdapter({
      driver: 'development-bypass',
      nodeEnv: 'development',
      explicitlyEnabled: true,
      maxBytes: 7,
    });

    await expect(
      adapter.scan(Readable.from([Buffer.from('1234567')])),
    ).resolves.toMatchObject({
      verdict: 'bypassed',
      scanner: 'development-bypass',
      sizeBytes: 7,
    });
    await expect(adapter.health()).resolves.toEqual({
      status: 'bypassed',
      scanner: 'development-bypass',
      durationMs: 0,
    });
    await expect(
      adapter.scan(Readable.from([Buffer.from('12345678')])),
    ).rejects.toMatchObject({ code: 'MALWARE_SCANNER_LIMIT_EXCEEDED' });
  });

  it('honors cancellation even for an empty stream', async () => {
    const adapter = new DevelopmentBypassScannerAdapter({
      driver: 'development-bypass',
      nodeEnv: 'development',
      explicitlyEnabled: true,
      maxBytes: 7,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.scan(Readable.from([]), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'MALWARE_SCANNER_ABORTED' });
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
