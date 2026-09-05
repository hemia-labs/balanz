import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { ClientAccountsModule } from '../client-accounts/client-accounts.module';
import { LegalEntity } from '../client-accounts/entities/legal-entity.entity';
import { FiscalInfrastructureModule } from '../fiscal-platform/fiscal-infrastructure.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { SessionsModule } from '../sessions/sessions.module';
import { CfdiController } from './controllers/cfdi.controller';
import { IngestionQueryController } from './controllers/ingestion-query.controller';
import { XmlIngestionController } from './controllers/xml-ingestion.controller';
import { CfdiQueryService } from './services/cfdi-query.service';
import { IngestionQueryService } from './services/ingestion-query.service';
import { XmlUploadService } from './services/xml-upload.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([LegalEntity]),
    ClientAccountsModule,
    AuditModule,
    FiscalInfrastructureModule,
    IngestionModule,
    SessionsModule,
  ],
  controllers: [
    XmlIngestionController,
    IngestionQueryController,
    CfdiController,
  ],
  providers: [XmlUploadService, IngestionQueryService, CfdiQueryService],
})
export class CfdiApiModule {}
