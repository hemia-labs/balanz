import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CfdiParserModule } from '../cfdi-parser';
import type { FiscalPlatformConfig } from '../../config/fiscal-platform.config';
import { FiscalInfrastructureModule } from '../fiscal-platform/fiscal-infrastructure.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { CfdiWorkerPersistenceService } from './workers/cfdi-worker-persistence.service';
import { ManualXmlJobHandler } from './workers/manual-xml-job.handler';

const configuredParser = CfdiParserModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const limits =
      config.getOrThrow<FiscalPlatformConfig>('fiscalPlatform').limits;
    return {
      maxBytes: limits.xmlBytes,
      maxDepth: limits.xmlDepth,
      maxNodes: limits.xmlNodes,
      maxAttributes: limits.xmlAttributes,
      maxAttributesPerElement: limits.xmlAttributesPerElement,
      maxTextNodeBytes: limits.xmlTextNodeBytes,
      parseTimeoutMs: limits.xmlParsingMilliseconds,
    };
  },
});

@Module({
  imports: [
    ConfigModule,
    IngestionModule,
    FiscalInfrastructureModule,
    configuredParser,
  ],
  providers: [CfdiWorkerPersistenceService, ManualXmlJobHandler],
  exports: [ManualXmlJobHandler],
})
export class CfdiProcessingModule {}
