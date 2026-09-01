import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CurrentSession,
  CurrentTenant,
} from '../../common/decorators/current-session.decorator';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../../common/decorators/request-context.decorator';
import { SessionGuard } from '../../common/guards/session.guard';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import type { AuthSession } from '../sessions/entities/auth-session.entity';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import {
  CreateExportDto,
  CreateSatDownloadJobDto,
} from './dtos/fiscal-operation.dtos';
import { FiscalOperationsService } from './fiscal-operations.service';
import { PrivateObjectAccessService } from './private-object-access.service';

@Controller()
@UseGuards(SessionGuard, TenantAccessGuard)
export class FiscalOperationsController {
  constructor(
    private readonly service: FiscalOperationsService,
    private readonly objects: PrivateObjectAccessService,
  ) {}

  @Post('sat-download-jobs')
  satDownload(
    @Body() dto: CreateSatDownloadJobDto,
    @CurrentSession() session: AuthSession,
    @CurrentTenant() context: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.createSatDownload(dto, session, context, request);
  }

  @Post('exports')
  export(
    @Body() dto: CreateExportDto,
    @CurrentSession() session: AuthSession,
    @CurrentTenant() context: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.createExport(dto, session, context, request);
  }

  @Post('objects/:objectId/access-url')
  accessUrl(
    @Param('objectId', ParseUUIDPipe) objectId: string,
    @CurrentSession() session: AuthSession,
    @CurrentTenant() context: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.objects.createAccessUrl(objectId, session, context, request);
  }

  @Get('objects/:objectId/content')
  async content(
    @Param('objectId', ParseUUIDPipe) objectId: string,
    @Query('token') token: string,
    @CurrentSession() session: AuthSession,
    @CurrentTenant() context: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
    @Res() response: Response,
  ) {
    if (typeof token !== 'string' || token.length !== 64) {
      throw new NotFoundException('Object not found');
    }
    const storageKey = await this.objects.consume(
      objectId,
      token,
      session,
      context,
      request,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader(
      'X-Accel-Redirect',
      `/protected-objects/${encodeURIComponent(storageKey)}`,
    );
    response.status(204).send();
  }
}
