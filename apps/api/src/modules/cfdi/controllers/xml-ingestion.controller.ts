import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentRequestContext } from '../../../common/decorators/request-context.decorator';
import type { RequestContext } from '../../../common/decorators/request-context.decorator';
import { CurrentTenant } from '../../../common/decorators/current-session.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { SessionGuard } from '../../../common/guards/session.guard';
import { TenantAccessGuard } from '../../../common/guards/tenant-access.guard';
import type { SessionAuthorizationContext } from '../../sessions/session.types';
import { XmlUploadService } from '../services/xml-upload.service';

@Controller()
@UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
export class XmlIngestionController {
  constructor(private readonly uploads: XmlUploadService) {}

  @Post('legal-entities/:legalEntityId/ingestions/xml')
  @Permissions('ingestion.create')
  @HttpCode(HttpStatus.ACCEPTED)
  upload(
    @Param('legalEntityId', ParseUUIDPipe) legalEntityId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() requestContext: RequestContext,
  ) {
    return this.uploads.upload(
      legalEntityId,
      idempotencyKey,
      request,
      tenant,
      requestContext,
    );
  }
}
