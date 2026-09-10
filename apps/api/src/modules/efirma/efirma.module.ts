import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SessionsModule } from '../sessions/sessions.module';
import { FiscalInfrastructureModule } from '../fiscal-platform/fiscal-infrastructure.module';
import { FiscalTenantTransactionService } from '../../database/rls/fiscal-tenant-transaction.service';
import { EfirmaRepository } from './efirma.repository';
import { EfirmaController } from './efirma.controller';
import { EfirmaPreparationService } from './efirma-preparation.service';
import { EfirmaConsumerService } from './efirma-consumer.service';
import { EfirmaCleanupService } from './efirma-cleanup.service';

@Module({
  imports: [FiscalInfrastructureModule],
  providers: [FiscalTenantTransactionService, EfirmaRepository],
  exports: [FiscalInfrastructureModule, EfirmaRepository],
})
class EfirmaPersistenceModule {}

@Module({
  imports: [EfirmaPersistenceModule, AuthModule, SessionsModule],
  controllers: [EfirmaController],
  providers: [EfirmaPreparationService],
})
export class EfirmaApiModule {}

/** No AuthModule, public controller, SAT job handler, or one-time secret cache in the worker. */
@Module({
  imports: [EfirmaPersistenceModule],
  providers: [EfirmaConsumerService, EfirmaCleanupService],
  exports: [EfirmaConsumerService],
})
export class EfirmaWorkerModule {}
