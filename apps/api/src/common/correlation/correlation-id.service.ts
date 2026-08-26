import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

@Injectable()
export class CorrelationIdService {
  private readonly storage = new AsyncLocalStorage<string>();

  run(correlationId: string, work: () => void): void {
    this.storage.run(correlationId, work);
  }

  current(): string | undefined {
    return this.storage.getStore();
  }
}
