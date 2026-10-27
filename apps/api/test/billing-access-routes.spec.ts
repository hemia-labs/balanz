import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BillingAccessGuard } from '../src/modules/billing/payments-access.service';
import { XmlIngestionController } from '../src/modules/cfdi/controllers/xml-ingestion.controller';
import { ZipIngestionController } from '../src/modules/cfdi/controllers/zip-ingestion.controller';
import { IngestionQueryController } from '../src/modules/cfdi/controllers/ingestion-query.controller';
import { SatController } from '../src/modules/sat-download/sat.controller';
import { MonthlyController } from '../src/modules/client-accounts/monthly.controller';
import { FiscalOperationsController } from '../src/modules/fiscal-operations/fiscal-operations.controller';

const protectedHandlers = [
  XmlIngestionController.prototype.upload,
  ZipIngestionController.prototype.init,
  ZipIngestionController.prototype.confirm,
  IngestionQueryController.prototype.retry,
  SatController.prototype.create,
  SatController.prototype.retry,
  SatController.prototype.retryPackage,
  MonthlyController.prototype.execute,
  MonthlyController.prototype.prepareClose,
  MonthlyController.prototype.close,
];

it.each(protectedHandlers)('protects new fiscal admission %p', (handler) => {
  const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
  expect(guards).toContain(BillingAccessGuard);
});

it.each([
  IngestionQueryController.prototype.get,
  SatController.prototype.get,
  SatController.prototype.cancel,
  SatController.prototype.prepare,
  ZipIngestionController.prototype.upload,
  MonthlyController.prototype.list,
  FiscalOperationsController.prototype.export,
])(
  'preserves reads, exports and continuation of accepted work %p',
  (handler) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as
      | unknown[]
      | undefined;
    expect(guards ?? []).not.toContain(BillingAccessGuard);
  },
);
