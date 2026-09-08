import {
  Controller,
  Get,
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
import { pipeline } from 'node:stream/promises';
import { CurrentRequestContext } from '../../../common/decorators/request-context.decorator';
import type { RequestContext } from '../../../common/decorators/request-context.decorator';
import { CurrentTenant } from '../../../common/decorators/current-session.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { SessionGuard } from '../../../common/guards/session.guard';
import { TenantAccessGuard } from '../../../common/guards/tenant-access.guard';
import type { SessionAuthorizationContext } from '../../sessions/session.types';
import { CfdiListQueryDto } from '../dtos/cfdi-query.dtos';
import { CfdiQueryService } from '../services/cfdi-query.service';

@Controller()
@UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
export class CfdiController {
  constructor(private readonly service: CfdiQueryService) {}

  @Get('legal-entities/:legalEntityId/cfdis')
  @Permissions('cfdi.view')
  list(
    @Param('legalEntityId', ParseUUIDPipe) legalEntityId: string,
    @Query() query: CfdiListQueryDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.list(legalEntityId, query, tenant);
  }

  @Get('cfdis/:cfdiId')
  @Permissions('cfdi.view')
  detail(
    @Param('cfdiId', ParseUUIDPipe) cfdiId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.detail(cfdiId, tenant);
  }

  @Post('cfdis/:cfdiId/access-url')
  @Permissions('cfdi.view', 'cfdi.download')
  @HttpCode(HttpStatus.CREATED)
  createAccessUrl(
    @Param('cfdiId', ParseUUIDPipe) cfdiId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.createAccessGrant(cfdiId, tenant, request);
  }

  @Get('cfdis/:cfdiId/content')
  @Permissions('cfdi.view', 'cfdi.download')
  async content(
    @Param('cfdiId', ParseUUIDPipe) cfdiId: string,
    @Query('token') token: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
    @Res() response: Response,
  ): Promise<void> {
    const download = await this.service.consumeAccessGrant(
      cfdiId,
      token,
      tenant,
      request,
    );
    response.status(HttpStatus.OK);
    response.setHeader('Content-Type', 'application/xml');
    response.setHeader('Content-Length', String(download.sizeBytes));
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="cfdi-${cfdiId}.xml"`,
    );
    await pipeline(download.stream, response);
  }
}
