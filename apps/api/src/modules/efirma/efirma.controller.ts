import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SessionGuard } from '../../common/guards/session.guard';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import { AuthService } from '../auth/auth.service';
import { VerifyMfaDto } from '../auth/dtos/verify-mfa.dto';
import { AuthSession } from '../sessions/entities/auth-session.entity';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { SessionsService } from '../sessions/sessions.service';
import { EfirmaRepository } from './efirma.repository';
import { EfirmaPreparationService } from './efirma-preparation.service';
import { receiveCredentials } from './receive-credentials';

@Controller('legal-entities/:legalEntityId')
@UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
@Permissions('credentials.manage')
export class EfirmaController {
  constructor(
    private readonly repository: EfirmaRepository,
    private readonly preparation: EfirmaPreparationService,
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @Post('reauth-grants')
  async grant(
    @Param('legalEntityId', ParseUUIDPipe) id: string,
    @Body() input: VerifyMfaDto,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @CurrentRequestContext() context: RequestContext,
  ) {
    await this.repository.generation();
    const result = await this.auth.reauthenticate(
      session,
      input.code,
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
    );
    this.sessions.setCookie(response, result.rawSessionToken);
    response.setHeader('Cache-Control', 'no-store');
    return this.repository.issueGrant(
      result.context,
      id,
      context.correlationId,
    );
  }

  @Post('efirma-sessions')
  @HttpCode(202)
  async prepare(
    @Param('legalEntityId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() context: RequestContext,
  ) {
    await this.repository.generation();
    response.setHeader('Cache-Control', 'no-store');
    return this.preparation.prepare(
      tenant,
      id,
      key ?? '',
      await receiveCredentials(request),
      context.correlationId,
    );
  }

  @Get('efirma-sessions/:sessionId')
  status(
    @Param('legalEntityId', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.repository.status(tenant, id, sessionId);
  }

  @Post('efirma-sessions/:sessionId/revoke')
  @HttpCode(200)
  revoke(
    @Param('legalEntityId', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.repository.revoke(tenant, id, sessionId, context.correlationId);
  }
}
