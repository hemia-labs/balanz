import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { parsePaymentSnapshot, type PaymentSnapshot } from '@hemia/payments';
import type { PaymentsSettings } from '../../config/payments.config';

/** Balanz's optional durable copy. Payment attempts and financial recovery remain in Billing. */
@Injectable()
export class PaymentsSnapshotService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}
  async apply(
    input: PaymentSnapshot,
    expectedOrganizationId?: string,
  ): Promise<{ applied: boolean }> {
    const product =
      this.config.getOrThrow<PaymentsSettings>('payments').connection
        ?.productCode;
    if (!product) throw new Error('PAYMENTS_CONNECTION is required');
    const snapshot = parsePaymentSnapshot(
      input,
      product,
      expectedOrganizationId,
    );
    return this.db.transaction(async (manager) => {
      await manager.query('SET LOCAL ROLE balanz_api');
      const rows = await manager.query<Array<{ applied: boolean }>>(
        'SELECT public.payments_apply_snapshot($1::uuid,$2::text,$3::bigint,$4::timestamptz,$5::jsonb,$6::jsonb) AS applied',
        [
          snapshot.organizationId,
          snapshot.productCode,
          snapshot.revision,
          snapshot.confirmedAt,
          JSON.stringify(snapshot.license),
          JSON.stringify(snapshot.subscription),
        ],
      );
      return { applied: rows[0]?.applied === true };
    });
  }
}
