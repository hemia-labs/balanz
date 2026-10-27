import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentsModule,
  type PaymentsModuleOptions,
} from '@hemia/payments/nestjs';
import {
  PaymentsApplicationModule,
  PaymentsApplicationService,
} from './payments-application.service';
import { PaymentsSnapshotService } from './payments-snapshot.service';
import { PaymentsSettings } from '../../config/payments.config';
import {
  BillingAccessGuard,
  PaymentsAccessController,
  PaymentsAccessService,
} from './payments-access.service';
import { FiscalTenantTransactionService } from '../../database/rls/fiscal-tenant-transaction.service';

@Module({
  imports: [
    PaymentsApplicationModule,
    PaymentsModule.forRootAsync({
      imports: [PaymentsApplicationModule],
      inject: [
        ConfigService,
        PaymentsApplicationService,
        PaymentsSnapshotService,
      ],
      useFactory: (
        config: ConfigService,
        app: PaymentsApplicationService,
        snapshots: PaymentsSnapshotService,
      ): PaymentsModuleOptions => {
        const { connection, clientSecret } =
          config.getOrThrow<PaymentsSettings>('payments');
        if (!connection) throw new Error('PAYMENTS_CONNECTION is required');
        return {
          connection,
          clientSecret,
          authorize: (request, operation) => app.authorize(request, operation),
          returnUrls: (context, attemptId) =>
            app.returnUrls(context, attemptId),
          onSnapshot: (snapshot) => snapshots.apply(snapshot),
          legal: connection.legal
            ? {
                ...connection.legal,
                resolveContext: (input) => app.resolveLegalContext(input),
              }
            : undefined,
        };
      },
    }),
  ],
  controllers: [PaymentsAccessController],
  providers: [
    PaymentsAccessService,
    BillingAccessGuard,
    FiscalTenantTransactionService,
  ],
  exports: [PaymentsAccessService, BillingAccessGuard],
})
export class BillingModule {}
