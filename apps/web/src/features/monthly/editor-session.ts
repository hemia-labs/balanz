/** Memory-only serialized writes. Revocation fences late responses and queued drafts. */
export class MonthlyEditorSession {
  private tail: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private active = true;
  version = 0;
  lastActivity = 0;
  pending = 0;
  constructor(readonly instanceToken: string) {}
  activity() {
    this.lastActivity = Date.now();
  }
  shouldRenew(now = Date.now()) {
    return (
      this.active && this.lastActivity > 0 && now - this.lastActivity < 90000
    );
  }
  enqueue<T extends { version: number }>(
    write: (version: number) => Promise<T>,
    markActivity = true,
  ): Promise<T> {
    const generation = this.generation;
    this.pending++;
    if (markActivity) this.activity();
    const next = this.tail.then(async () => {
      if (!this.active || generation !== this.generation)
        throw new Error("EDITOR_CONTEXT_EXPIRED");
      const result = await write(this.version);
      if (!this.active || generation !== this.generation)
        throw new Error("EDITOR_CONTEXT_EXPIRED");
      this.version = result.version;
      return result;
    });
    this.tail = next.catch(() => undefined);
    return next.finally(() => {
      this.pending--;
    });
  }
  async flush() {
    await this.tail;
  }
  invalidate() {
    this.active = false;
    this.generation++;
    this.lastActivity = 0;
  }
}
