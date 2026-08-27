import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { Membership } from '../memberships/entities/membership.entity';
import { SessionsModule } from '../sessions/sessions.module';
import { AccountAssignmentsController } from './account-assignments.controller';
import { AccountAssignmentsService } from './account-assignments.service';
import { ClientAccountScopeService } from './client-account-scope.service';
import { ClientAccountsController } from './client-accounts.controller';
import { ClientAccountsService } from './client-accounts.service';
import { AccountAssignment } from './entities/account-assignment.entity';
import { ClientAccount } from './entities/client-account.entity';
import { FiscalYear } from './entities/fiscal-year.entity';
import { LegalEntity } from './entities/legal-entity.entity';
import { Period } from './entities/period.entity';
import { FiscalYearsController } from './fiscal-years.controller';
import { FiscalYearsService } from './fiscal-years.service';
import { LegalEntitiesController } from './legal-entities.controller';
import { LegalEntitiesService } from './legal-entities.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ClientAccount,
      LegalEntity,
      AccountAssignment,
      FiscalYear,
      Period,
      Membership,
    ]),
    AuditModule,
    SessionsModule,
  ],
  controllers: [
    ClientAccountsController,
    LegalEntitiesController,
    AccountAssignmentsController,
    FiscalYearsController,
  ],
  providers: [
    ClientAccountScopeService,
    ClientAccountsService,
    LegalEntitiesService,
    AccountAssignmentsService,
    FiscalYearsService,
  ],
  exports: [ClientAccountScopeService],
})
export class ClientAccountsModule {}
