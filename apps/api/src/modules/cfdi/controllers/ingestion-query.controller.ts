import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentRequestContext } from '../../../common/decorators/request-context.decorator';
import type { RequestContext } from '../../../common/decorators/request-context.decorator';
import { CurrentTenant } from '../../../common/decorators/current-session.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { SessionGuard } from '../../../common/guards/session.guard';
import { TenantAccessGuard } from '../../../common/guards/tenant-access.guard';
import type { SessionAuthorizationContext } from '../../sessions/session.types';
import {
  IngestionItemsQueryDto,
  ProcessesQueryDto,
} from '../dtos/cfdi-query.dtos';
import { IngestionQueryService } from '../services/ingestion-query.service';

@Controller()
@UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
export class IngestionQueryController {
  constructor(private readonly service: IngestionQueryService) {}

  @Get('ingestions/:ingestionJobId')
  @Permissions('ingestion.view')
  async get(
    @Param('ingestionJobId', ParseUUIDPipe) id: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.get(id, tenant);
    const etag = `"ingestion-${result.id}-${result.version}"`;
    response.setHeader('ETag', etag);
    if (!isTerminal(result.status)) response.setHeader('Retry-After', '2');
    if (ifNoneMatch === etag) {
      response.status(HttpStatus.NOT_MODIFIED);
      return;
    }
    return result;
  }

  @Get('ingestions/:ingestionJobId/items')
  @Permissions('ingestion.view')
  items(
    @Param('ingestionJobId', ParseUUIDPipe) id: string,
    @Query() query: IngestionItemsQueryDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.items(id, query, tenant);
  }

  @Post('ingestions/:ingestionJobId/retry')
  @Permissions('ingestion.retry')
  @HttpCode(HttpStatus.ACCEPTED)
  retry(
    @Param('ingestionJobId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.retry(id, idempotencyKey, tenant, request);
  }

  @Post('ingestions/:ingestionJobId/cancel')
  @Permissions('ingestion.cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  cancel(
    @Param('ingestionJobId', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.cancel(id, tenant);
  }

  @Get('processes')
  @Permissions('processes.view')
  processes(
    @Query() query: ProcessesQueryDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.processes(query, tenant);
  }
}

function isTerminal(status: string): boolean {
  return [
    'completed',
    'completed_with_issues',
    'failed_final',
    'cancelled',
  ].includes(status);
}
