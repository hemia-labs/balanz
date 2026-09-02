import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { ClientAccountsModule } from '../client-accounts/client-accounts.module';
import { FiscalOperation } from './entities/fiscal-operation.entity';
import { FiscalOperationsController } from './fiscal-operations.controller';
import { FiscalOperationsService } from './fiscal-operations.service';
import { LegalEntity } from '../client-accounts/entities/legal-entity.entity';
import { PrivateObject } from './entities/private-object.entity';
import { ObjectAccessGrant } from './entities/object-access-grant.entity';
import { PrivateObjectAccessService } from './private-object-access.service';
import { SessionsModule } from '../sessions/sessions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FiscalOperation,
      LegalEntity,
      PrivateObject,
      ObjectAccessGrant,
    ]),
    ClientAccountsModule,
    AuditModule,
    SessionsModule,
  ],
  controllers: [FiscalOperationsController],
  providers: [FiscalOperationsService, PrivateObjectAccessService],
  exports: [FiscalOperationsService],
})
export class FiscalOperationsModule {}
