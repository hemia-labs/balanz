import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenant } from '../../../common/decorators/current-session.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { SessionGuard } from '../../../common/guards/session.guard';
import { TenantAccessGuard } from '../../../common/guards/tenant-access.guard';
import type { SessionAuthorizationContext } from '../../sessions/session.types';
import { MonthlyService } from '../../client-accounts/monthly.service';
import { CfdiQueryService } from '../services/cfdi-query.service';
@Controller()
@UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
@Permissions('periods.view', 'cfdi.view')
export class MonthlyDocumentController {
  constructor(
    private readonly monthly: MonthlyService,
    private readonly cfdis: CfdiQueryService,
  ) {}
  @Get('periods/:periodId/monthly/items/:participationId/document')
  @Header('Cache-Control', 'no-store')
  async document(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Param('participationId', ParseUUIDPipe) participationId: string,
  ) {
    const binding = await this.monthly.visibleDocument(t, id, participationId);
    return this.cfdis.detail(binding.cfdiId, binding.context);
  }
}
