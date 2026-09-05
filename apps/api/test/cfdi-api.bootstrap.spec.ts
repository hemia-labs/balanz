import { type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditModule } from '../src/modules/audit/audit.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { ClientAccountsModule } from '../src/modules/client-accounts/client-accounts.module';
import { LegalEntity } from '../src/modules/client-accounts/entities/legal-entity.entity';
import { CfdiApiModule } from '../src/modules/cfdi/cfdi-api.module';
import { CfdiQueryService } from '../src/modules/cfdi/services/cfdi-query.service';
import { IngestionQueryService } from '../src/modules/cfdi/services/ingestion-query.service';
import { XmlUploadService } from '../src/modules/cfdi/services/xml-upload.service';
import { FiscalInfrastructureModule } from '../src/modules/fiscal-platform/fiscal-infrastructure.module';
import { IngestionModule } from '../src/modules/ingestion/ingestion.module';
import { SessionsModule } from '../src/modules/sessions/sessions.module';
import { SessionsService } from '../src/modules/sessions/sessions.service';

@Module({})
class StubClientAccountsModule {}

@Module({})
class StubFiscalInfrastructureModule {}

@Module({})
class StubIngestionModule {}

@Module({
  providers: [
    {
      provide: AuditService,
      useValue: { recordDirect: jest.fn() },
    },
  ],
  exports: [AuditService],
})
class StubAuditModule {}

@Module({
  providers: [
    {
      provide: SessionsService,
      useValue: { resolve: jest.fn() },
    },
  ],
  exports: [SessionsService],
})
class StubSessionsModule {}

describe('CfdiApiModule bootstrap', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('resolves its runtime guards without external infrastructure', async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [CfdiApiModule],
    })
      .overrideModule(ClientAccountsModule)
      .useModule(StubClientAccountsModule)
      .overrideModule(AuditModule)
      .useModule(StubAuditModule)
      .overrideModule(FiscalInfrastructureModule)
      .useModule(StubFiscalInfrastructureModule)
      .overrideModule(IngestionModule)
      .useModule(StubIngestionModule)
      .overrideModule(SessionsModule)
      .useModule(StubSessionsModule)
      .overrideProvider(getRepositoryToken(LegalEntity))
      .useValue({})
      .overrideProvider(XmlUploadService)
      .useValue({})
      .overrideProvider(IngestionQueryService)
      .useValue({})
      .overrideProvider(CfdiQueryService)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    expect(app).toBeDefined();
  });
});
