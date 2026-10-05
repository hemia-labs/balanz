import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { AuthService } from '../auth/auth.service';
import { SessionsService } from '../sessions/sessions.service';
import { AuthSession } from '../sessions/entities/auth-session.entity';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { receiveCredentials } from '../efirma/receive-credentials';
import { CreateSatJobDto, SatReauthDto } from './sat.dtos';
import { SatService } from './sat.service';
@Controller('sat-download-jobs')
@UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
@Permissions('sat.download', 'credentials.manage')
export class SatController {
  constructor(
    private readonly service: SatService,
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}
  @Post()
  @HttpCode(202)
  create(
    @Body() input: CreateSatJobDto,
    @Headers('idempotency-key') key: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() c: RequestContext,
  ) {
    return this.service.create(tenant, input, key ?? '', c.correlationId);
  }
  @Get()
  list(
    @Query('legalEntityId', ParseUUIDPipe) entity: string,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentTenant() t: SessionAuthorizationContext,
  ) {
    return this.service.list(t, entity, Number(page ?? 1), Number(limit ?? 25));
  }
  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: SessionAuthorizationContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.service.get(t, id);
  }
  @Get(':id/packages')
  packages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('after') after: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentTenant() t: SessionAuthorizationContext,
  ) {
    return this.service.packages(
      t,
      id,
      Number(after ?? 0),
      Number(limit ?? 50),
    );
  }
  @Get(':id/packages/:packageId/items')
  items(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('packageId', ParseUUIDPipe) packageId: string,
    @Query('after') after: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.items(
      tenant,
      id,
      packageId,
      Number(after ?? 0),
      Number(limit ?? 50),
    );
  }
  @Post(':id/reauth-grants')
  async grant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: SatReauthDto,
    @CurrentSession() session: AuthSession,
    @CurrentTenant() t: SessionAuthorizationContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @CurrentRequestContext() c: RequestContext,
  ) {
    await this.service.binding(t, id);
    const result = await this.auth.reauthenticate(
      session,
      input.code,
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
    );
    this.sessions.setCookie(response, result.rawSessionToken);
    response.setHeader('Cache-Control', 'no-store');
    const binding = await this.service.binding(result.context, id);
    const job = await this.service.get(result.context, id);
    return this.service.custody.issueGrant(
      result.context,
      job.legalEntityId,
      c.correlationId,
      binding,
    );
  }
  @Post(':id/authorizations')
  @HttpCode(202)
  async prepare(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string,
    @CurrentTenant() t: SessionAuthorizationContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @CurrentRequestContext() c: RequestContext,
  ) {
    await this.service.get(t, id);
    response.setHeader('Cache-Control', 'no-store');
    return this.service.prepare(
      t,
      id,
      key ?? '',
      await receiveCredentials(request),
      c.correlationId,
    );
  }
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: SessionAuthorizationContext,
    @CurrentRequestContext() c: RequestContext,
  ) {
    return this.service.cancel(t, id, c.correlationId);
  }
  @Post(':id/retry')
  @HttpCode(202)
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: SessionAuthorizationContext,
    @CurrentRequestContext() c: RequestContext,
  ) {
    return this.service.retry(t, id, undefined, c.correlationId);
  }
  @Post(':id/packages/:packageId/retry')
  @HttpCode(202)
  retryPackage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('packageId', ParseUUIDPipe) packageId: string,
    @CurrentTenant() t: SessionAuthorizationContext,
    @CurrentRequestContext() c: RequestContext,
  ) {
    return this.service.retry(t, id, packageId, c.correlationId);
  }
}
