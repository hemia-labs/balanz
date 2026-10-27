import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FiscalTenantTransactionService } from '../../database/rls/fiscal-tenant-transaction.service';
import { RedisModule } from '../redis/redis.module';
import { FiscalInfrastructureModule } from '../fiscal-platform/fiscal-infrastructure.module';
import { IngestionItem } from './entities/ingestion-item.entity';
import { IngestionJob } from './entities/ingestion-job.entity';
import { IngestionUpload } from './entities/ingestion-upload.entity';
import { IngestionJobRepository } from './services/ingestion-job.repository';
import { IngestionIdempotencyRepository } from './services/ingestion-idempotency.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([IngestionUpload, IngestionJob, IngestionItem]),
    FiscalInfrastructureModule,
    RedisModule,
  ],
  providers: [
    FiscalTenantTransactionService,
    IngestionIdempotencyRepository,
    IngestionJobRepository,
  ],
  exports: [
    FiscalTenantTransactionService,
    IngestionIdempotencyRepository,
    IngestionJobRepository,
  ],
})
export class IngestionModule {}
