import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EfirmaConfig } from '../../config/efirma.config';
import { VaultCustodyAdapter } from './vault-custody.adapter';
import {
  EFIRMA_VAULT_RUNTIME,
  EFIRMA_VAULT_CLEANUP,
} from './vault-custody.tokens';
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
  providers: [
    FiscalTenantTransactionService,
    EfirmaRepository,
    {
      provide: EFIRMA_VAULT_RUNTIME,
      inject: [ConfigService],
      useFactory: (configuration: ConfigService) => {
        const config = configuration.getOrThrow<EfirmaConfig>('efirma');
        return config.enabled && config.vault
          ? new VaultCustodyAdapter(config.vault)
          : null;
      },
    },
    {
      provide: EFIRMA_VAULT_CLEANUP,
      inject: [ConfigService],
      useFactory: (configuration: ConfigService) => {
        const config = configuration.getOrThrow<EfirmaConfig>('efirma');
        return config.enabled && config.cleanupVault
          ? new VaultCustodyAdapter(config.cleanupVault)
          : null;
      },
    },
  ],
  exports: [
    FiscalInfrastructureModule,
    EfirmaRepository,
    EFIRMA_VAULT_RUNTIME,
    EFIRMA_VAULT_CLEANUP,
  ],
})
export class EfirmaPersistenceModule {}

@Module({
  imports: [EfirmaPersistenceModule, AuthModule, SessionsModule],
  controllers: [EfirmaController],
  providers: [EfirmaPreparationService],
  exports: [EfirmaPreparationService],
})
export class EfirmaApiModule {}

/** No AuthModule, public controller, SAT job handler, or one-time secret cache in the worker. */
@Module({
  imports: [EfirmaPersistenceModule],
  providers: [EfirmaConsumerService, EfirmaCleanupService],
  exports: [EfirmaConsumerService],
})
export class EfirmaWorkerModule {}
