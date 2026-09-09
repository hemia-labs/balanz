export class UploadReceiverLeaseLostError extends Error {
  readonly code = 'JOB_STATE_CONFLICT';

  constructor(options?: ErrorOptions) {
    super('The durable upload receiver fence was lost', options);
    this.name = 'UploadReceiverLeaseLostError';
  }
}

export class UploadReceiverHeartbeat {
  private readonly controller = new AbortController();
  private timer?: NodeJS.Timeout;
  private pending: Promise<void> = Promise.resolve();
  private stopped = false;
  private failure?: Error;

  constructor(
    private currentVersion: number,
    private readonly intervalMs: number,
    private readonly renew: (version: number) => Promise<number | null>,
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  start(): void {
    this.schedule();
  }

  async stop(): Promise<number> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.pending;
    if (this.failure) throw this.failure;
    return this.currentVersion;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.pending = this.tick();
    }, this.intervalMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    try {
      const next = await this.renew(this.currentVersion);
      if (next === null) throw new UploadReceiverLeaseLostError();
      this.currentVersion = next;
    } catch (error) {
      this.failure =
        error instanceof UploadReceiverLeaseLostError
          ? error
          : new UploadReceiverLeaseLostError(
              error instanceof Error ? { cause: error } : undefined,
            );
      this.controller.abort(this.failure);
      this.stopped = true;
      return;
    }
    this.schedule();
  }
}
