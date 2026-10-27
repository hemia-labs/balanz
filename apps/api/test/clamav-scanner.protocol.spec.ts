import { createServer, type Server, type Socket } from 'node:net';
import { Readable } from 'node:stream';
import { ClamAvScannerAdapter } from '../src/modules/malware-scanner/adapters/clamav/clamav-scanner.adapter';

describe('ClamAvScannerAdapter INSTREAM protocol (in-process protocol peer)', () => {
  let peer: ClamProtocolPeer;

  afterEach(async () => {
    await peer?.close();
  });

  it('uses zINSTREAM framing, bounded chunks and returns a clean verdict', async () => {
    peer = await ClamProtocolPeer.start(() => 'stream: OK');
    const adapter = createAdapter(peer.port, { chunkSizeBytes: 16 });
    const payload = Buffer.alloc(70, 7);

    await expect(adapter.scan(Readable.from([payload]))).resolves.toMatchObject(
      {
        verdict: 'clean',
        scanner: 'clamav',
        sizeBytes: payload.length,
      },
    );
    expect(peer.commands).toEqual(['zINSTREAM']);
    expect(peer.receivedBodies).toEqual([payload]);
    expect(peer.frameLengths).toEqual([[16, 16, 16, 16, 6]]);
  });

  it('returns a sanitized infected verdict without throwing', async () => {
    peer = await ClamProtocolPeer.start(() => 'stream: Eicar-Signature FOUND');
    const adapter = createAdapter(peer.port);

    await expect(
      adapter.scan(Readable.from([Buffer.from('safe-test-payload')])),
    ).resolves.toMatchObject({
      verdict: 'infected',
      scanner: 'clamav',
      signature: 'Eicar-Signature',
    });
  });

  it('redacts an unexpected signature shape', async () => {
    peer = await ClamProtocolPeer.start(
      () => 'stream: ../../tenant-secret FOUND',
    );
    const adapter = createAdapter(peer.port);

    await expect(
      adapter.scan(Readable.from([Buffer.from('payload')])),
    ).resolves.toMatchObject({
      verdict: 'infected',
      signature: 'unidentified',
    });
  });

  it('checks health with zPING and requires PONG', async () => {
    peer = await ClamProtocolPeer.start(() => 'stream: OK');
    const adapter = createAdapter(peer.port);

    await expect(adapter.health()).resolves.toMatchObject({
      status: 'up',
      scanner: 'clamav',
    });
    expect(peer.commands).toEqual(['zPING']);
  });

  it('fails closed when the scanner is unavailable', async () => {
    peer = await ClamProtocolPeer.start(() => 'stream: OK');
    const closedPort = peer.port;
    await peer.close();
    const adapter = createAdapter(closedPort, {
      connectTimeoutMs: 100,
    });

    await expect(
      adapter.scan(Readable.from([Buffer.from('payload')])),
    ).rejects.toMatchObject({ code: 'MALWARE_SCANNER_UNAVAILABLE' });
    await expect(adapter.health()).resolves.toMatchObject({
      status: 'down',
      scanner: 'clamav',
      errorCode: 'MALWARE_SCANNER_UNAVAILABLE',
    });
  });

  it('fails closed on a total scan timeout', async () => {
    peer = await ClamProtocolPeer.start(() => null);
    const adapter = createAdapter(peer.port, { scanTimeoutMs: 50 });

    await expect(
      adapter.scan(Readable.from([Buffer.from('payload')])),
    ).rejects.toMatchObject({ code: 'MALWARE_SCANNER_TIMEOUT' });
  });

  it('times out even when the input stream itself stalls', async () => {
    peer = await ClamProtocolPeer.start(() => null);
    const adapter = createAdapter(peer.port, { scanTimeoutMs: 50 });
    const stalled = new Readable({ read() {} });

    await expect(adapter.scan(stalled)).rejects.toMatchObject({
      code: 'MALWARE_SCANNER_TIMEOUT',
    });
  });

  it('honors an already-aborted scan before opening a connection', async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = createAdapter(1);

    await expect(
      adapter.scan(Readable.from([]), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'MALWARE_SCANNER_ABORTED' });
  });

  it('honors an already-aborted health probe before opening a connection', async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = createAdapter(1);

    await expect(adapter.health(controller.signal)).resolves.toMatchObject({
      status: 'down',
      errorCode: 'MALWARE_SCANNER_ABORTED',
    });
  });

  it('enforces the client-side stream limit', async () => {
    peer = await ClamProtocolPeer.start(() => 'stream: OK');
    const adapter = createAdapter(peer.port, { maxBytes: 4 });

    await expect(
      adapter.scan(Readable.from([Buffer.from('12345')])),
    ).rejects.toMatchObject({ code: 'MALWARE_SCANNER_LIMIT_EXCEEDED' });
  });

  it('does not expose a raw malformed daemon response', async () => {
    peer = await ClamProtocolPeer.start(() => 'RFC_SECRET unexpected response');
    const adapter = createAdapter(peer.port);

    await expect(
      adapter.scan(Readable.from([Buffer.from('payload')])),
    ).rejects.toMatchObject({
      code: 'MALWARE_SCANNER_PROTOCOL_ERROR',
      message: 'The malware scanner returned an invalid scan response',
    });
  });
});

function createAdapter(
  port: number,
  overrides: Partial<{
    connectTimeoutMs: number;
    scanTimeoutMs: number;
    maxBytes: number;
    chunkSizeBytes: number;
  }> = {},
): ClamAvScannerAdapter {
  return new ClamAvScannerAdapter({
    driver: 'clamav',
    host: '127.0.0.1',
    port,
    connectTimeoutMs: overrides.connectTimeoutMs ?? 500,
    scanTimeoutMs: overrides.scanTimeoutMs ?? 1_000,
    maxBytes: overrides.maxBytes ?? 1024,
    chunkSizeBytes: overrides.chunkSizeBytes ?? 64,
  });
}

class ClamProtocolPeer {
  readonly commands: string[] = [];
  readonly receivedBodies: Buffer[] = [];
  readonly frameLengths: number[][] = [];
  private readonly sockets = new Set<Socket>();
  private closed = false;

  private constructor(
    private readonly server: Server,
    readonly port: number,
    private readonly responseFor: (body: Buffer) => string | null,
  ) {
    server.on('connection', (socket) => this.accept(socket));
  }

  static async start(
    responseFor: (body: Buffer) => string | null,
  ): Promise<ClamProtocolPeer> {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Protocol peer did not bind a TCP port');
    }
    return new ClamProtocolPeer(server, address.port, responseFor);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
    let buffered = Buffer.alloc(0);
    let command: string | undefined;
    let bodyChunks: Buffer[] = [];
    let frameLengths: number[] = [];

    socket.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!command) {
        const terminator = buffered.indexOf(0);
        if (terminator < 0) return;
        command = buffered.subarray(0, terminator).toString('ascii');
        this.commands.push(command);
        buffered = buffered.subarray(terminator + 1);
        if (command === 'zPING') {
          socket.end(Buffer.from('PONG\0', 'ascii'));
          return;
        }
      }

      while (buffered.length >= 4) {
        const length = buffered.readUInt32BE(0);
        if (length === 0) {
          buffered = buffered.subarray(4);
          const body = Buffer.concat(bodyChunks);
          this.receivedBodies.push(body);
          this.frameLengths.push(frameLengths);
          const response = this.responseFor(body);
          if (response !== null)
            socket.end(Buffer.from(`${response}\0`, 'utf8'));
          bodyChunks = [];
          frameLengths = [];
          return;
        }
        if (buffered.length < length + 4) return;
        bodyChunks.push(buffered.subarray(4, length + 4));
        frameLengths.push(length);
        buffered = buffered.subarray(length + 4);
      }
    });
  }
}
