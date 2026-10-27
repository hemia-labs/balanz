import { Injectable } from '@nestjs/common';
import type { ClaimResult } from '../../ingestion/services/ingestion-job.repository';
import type { IngestionJobHandler } from '../../ingestion/workers/ingestion-job.registry';
import { CfdiWorkerPersistenceService } from './cfdi-worker-persistence.service';
import { XmlObjectProcessor } from './xml-object.processor';

@Injectable()
export class ManualXmlJobHandler implements IngestionJobHandler {
  readonly source = 'manual_xml' as const;
  constructor(
    private readonly persistence: CfdiWorkerPersistenceService,
    private readonly processor: XmlObjectProcessor,
  ) {}
  async handle(job: ClaimResult, signal: AbortSignal) {
    return this.processor.process(
      job,
      await this.persistence.loadAndBegin(job),
      signal,
    );
  }
}
