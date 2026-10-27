import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { PaymentsSnapshotService } from '../src/modules/billing/payments-snapshot.service';
import { paymentSnapshot } from './payments-snapshot-fixture';
test('snapshot sink binds the configured product and passes source confirmation with both copies atomically', async () => {
  const snapshot = paymentSnapshot();
  const query = jest
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ applied: true }]);
  const transaction = jest.fn(
    (work: (manager: EntityManager) => Promise<unknown>) =>
      work({ query } as unknown as EntityManager),
  );
  const sink = new PaymentsSnapshotService(
    { transaction } as never,
    new ConfigService({
      payments: { connection: { productCode: snapshot.productCode } },
    }),
  );
  expect(await sink.apply(snapshot)).toEqual({ applied: true });
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenNthCalledWith(1, 'SET LOCAL ROLE balanz_api');
  expect(query).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining('payments_apply_snapshot'),
    [
      snapshot.organizationId,
      snapshot.productCode,
      snapshot.revision,
      snapshot.confirmedAt,
      JSON.stringify(snapshot.license),
      JSON.stringify(snapshot.subscription),
    ],
  );
  await expect(
    sink.apply({ ...snapshot, productCode: 'another' }),
  ).rejects.toThrow();
  await expect(sink.apply(snapshot, randomUUID())).rejects.toThrow();
  await expect(
    sink.apply({ ...snapshot, subscription: null }),
  ).rejects.toThrow();
  expect(transaction).toHaveBeenCalledTimes(1);
});
