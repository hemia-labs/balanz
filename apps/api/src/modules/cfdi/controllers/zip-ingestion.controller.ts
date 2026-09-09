import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../../../common/decorators/request-context.decorator';
import { CurrentTenant } from '../../../common/decorators/current-session.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { SessionGuard } from '../../../common/guards/session.guard';
import { TenantAccessGuard } from '../../../common/guards/tenant-access.guard';
import type { SessionAuthorizationContext } from '../../sessions/session.types';
import { ZipUploadInitDto } from '../dtos/zip-upload.dtos';
import { ZipUploadService } from '../services/zip-upload.service';

@Controller()
@UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
export class ZipIngestionController {
  constructor(private readonly uploads: ZipUploadService) {}

  @Post('legal-entities/:legalEntityId/ingestions/zip/init')
  @Permissions('ingestion.create')
  init(
    @Param('legalEntityId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: ZipUploadInitDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() context: RequestContext,
  ) {
    return this.uploads.init(id, key, body, tenant, context);
  }

  @Put('ingestion-uploads/:uploadId/zip/content')
  @Permissions('ingestion.create')
  upload(
    @Param('uploadId', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.uploads.upload(id, request, tenant);
  }

  @Post('ingestion-uploads/:uploadId/zip/confirm')
  @Permissions('ingestion.create')
  @HttpCode(202)
  confirm(
    @Param('uploadId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() context: RequestContext,
  ) {
    return this.uploads.confirm(id, key, tenant, context);
  }
}
