import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenant } from '../../common/decorators/current-session.decorator';
import { SessionGuard } from '../../common/guards/session.guard';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { MonthlyService } from './monthly.service';
import {
  MonthlyQueryDto,
  MonthlyWriteDto,
  LeaseDto,
  DecisionDto,
  BulkDto,
  ChecklistDto,
  IncidentDto,
  SourceLinkDto,
  CloseDto,
  CategoryDto,
  TemplateDto,
} from './monthly.dtos';
@Controller('periods/:periodId')
@UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
@Permissions('cfdi.view', 'periods.view')
export class MonthlyController {
  constructor(private readonly service: MonthlyService) {}
  @Get('monthly')
  @Header('Cache-Control', 'no-store')
  overview(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
  ) {
    return this.service.overview(t, id);
  }
  @Get('monthly/items')
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Query() q: MonthlyQueryDto,
  ) {
    return this.service.list(t, id, q);
  }
  @Get('monthly/news')
  @Header('Cache-Control', 'no-store')
  news(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
  ) {
    return this.service.news(t, id);
  }
  @Get('monthly/checklist')
  @Header('Cache-Control', 'no-store')
  checklist(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
  ) {
    return this.service.checklist(t, id);
  }
  @Get('monthly/incidents')
  @Header('Cache-Control', 'no-store')
  incidents(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Query() q: MonthlyQueryDto,
  ) {
    return this.service.incidents(t, id, q.page, q.limit);
  }
  @Get('monthly/assignees')
  @Header('Cache-Control', 'no-store')
  assignees(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
  ) {
    return this.service.assignees(t, id);
  }
  @Get('monthly/categories')
  @Header('Cache-Control', 'no-store')
  categories(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
  ) {
    return this.service.categories(t, id);
  }
  @Get('monthly/closes')
  @Header('Cache-Control', 'no-store')
  closes(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
  ) {
    return this.service.closes(t, id);
  }
  @Post('monthly/lease')
  @Header('Cache-Control', 'no-store')
  acquire(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Body() input: LeaseDto,
  ) {
    return this.service.acquire(t, id, input);
  }
  @Post('monthly/lease/takeover')
  @Header('Cache-Control', 'no-store')
  takeover(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Body() input: LeaseDto,
  ) {
    return this.service.acquire(t, id, input, true);
  }
  @Post('monthly/lease/renew')
  @Header('Cache-Control', 'no-store')
  renew(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Body() input: MonthlyWriteDto,
  ) {
    return this.service.renew(t, id, input);
  }
  @Post('monthly/lease/release')
  @Header('Cache-Control', 'no-store')
  release(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Body() input: MonthlyWriteDto,
  ) {
    return this.service.renew(t, id, input, true);
  }
  @Post('monthly/decisions/:participationId')
  @Header('Cache-Control', 'no-store')
  decision(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Param('participationId', ParseUUIDPipe) participationId: string,
    @Body() input: DecisionDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.decision(t, id, participationId, input, key ?? '');
  }
  @Get('monthly/decisions/:participationId/history')
  @Header('Cache-Control', 'no-store')
  history(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Param('participationId', ParseUUIDPipe) participationId: string,
  ) {
    return this.service.history(t, id, participationId);
  }
  @Post('monthly/bulk/preview')
  @Header('Cache-Control', 'no-store')
  preview(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Body() input: BulkDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.bulk(t, id, input, key ?? '', true);
  }
  @Post('monthly/bulk/execute')
  @Header('Cache-Control', 'no-store')
  execute(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Body() input: BulkDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.bulk(t, id, input, key ?? '', false);
  }
  @Post('monthly/checklist')
  @Header('Cache-Control', 'no-store')
  confirmChecklist(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Body() input: ChecklistDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.confirmChecklist(t, id, input, key ?? '');
  }
  @Get('monthly/incidents/:incidentId/history')
  @Header('Cache-Control', 'no-store')
  incidentHistory(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @Query() q: MonthlyQueryDto,
  ) {
    return this.service.incidentHistory(t, id, incidentId, q.page, q.limit);
  }
  @Post('monthly/incidents/:incidentId')
  @Header('Cache-Control', 'no-store')
  manageIncident(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @Body() input: IncidentDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.manageIncident(t, id, incidentId, input, key ?? '');
  }
  @Post('monthly/sources')
  @Header('Cache-Control', 'no-store')
  linkSource(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Body() input: SourceLinkDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.linkSource(t, id, input, key ?? '');
  }
  @Post('monthly/prepare-close')
  @Header('Cache-Control', 'no-store')
  prepareClose(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Body() input: CloseDto,
  ) {
    return this.service.prepareClose(t, id, input);
  }
  @Post('close')
  @Header('Cache-Control', 'no-store')
  close(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Body() input: CloseDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.close(t, id, input, key ?? '');
  }
  @Post('reopen')
  @Header('Cache-Control', 'no-store')
  reopen(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Body() input: MonthlyWriteDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.reopen(t, id, input, key ?? '');
  }
  @Get('monthly/closes/:version')
  @Header('Cache-Control', 'no-store')
  closeVersion(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Param('version') version: string,
    @Query() q: MonthlyQueryDto,
  ) {
    return this.service.closes(t, id, Number(version), q.page, q.limit);
  }
  @Post('monthly/categories')
  @Header('Cache-Control', 'no-store')
  createCategory(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Body() input: CategoryDto,
  ) {
    return this.service.category(t, id, undefined, input);
  }
  @Post('monthly/categories/:categoryId')
  @Header('Cache-Control', 'no-store')
  updateCategory(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() input: CategoryDto,
  ) {
    return this.service.category(t, id, categoryId, input);
  }
  @Get('monthly/checklist-template')
  @Header('Cache-Control', 'no-store')
  template(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
  ) {
    return this.service.checklistTemplate(t, id);
  }
  @Post('monthly/checklist-template')
  @Header('Cache-Control', 'no-store')
  configureChecklist(
    @CurrentTenant() t: SessionAuthorizationContext,
    @Param('periodId', ParseUUIDPipe) id: string,
    @Body() input: TemplateDto,
  ) {
    return this.service.configureChecklist(t, id, input);
  }
}
