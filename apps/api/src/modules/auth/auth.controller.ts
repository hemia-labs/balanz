import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentSession } from '../../common/decorators/current-session.decorator';
import { CurrentAuthorization } from '../../common/decorators/current-session.decorator';
import { OnboardingGuard } from '../../common/guards/onboarding.guard';
import { SessionGuard } from '../../common/guards/session.guard';
import { AuthSession } from '../sessions/entities/auth-session.entity';
import { SessionsService } from '../sessions/sessions.service';
import { AuthService } from './auth.service';
import { ChangeOrganizationDto } from './dtos/change-organization.dto';
import { RegisterDto } from './dtos/register.dto';
import { ResendVerificationDto } from './dtos/resend-verification.dto';
import { VerifyEmailDto } from './dtos/verify-email.dto';
import { VerifyMfaDto } from './dtos/verify-mfa.dto';
import { LoginDto } from './dtos/login.dto';
import { DisableMfaDto } from './dtos/disable-mfa.dto';
import { RequestPasswordResetDto } from './dtos/request-password-reset.dto';
import { ConfirmPasswordResetDto } from './dtos/confirm-password-reset.dto';
import type { SessionAuthorizationContext } from '../sessions/session.types';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @Post('register')
  register(@Body() input: RegisterDto, @Req() request: Request) {
    return this.auth.register(input, this.clientIp(request));
  }

  @Post('login')
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(
      input,
      this.clientIp(request),
      request.get('user-agent') ?? undefined,
    );
    this.sessions.setCookie(response, result.rawSessionToken);
    return {
      requiresMfa: result.requiresMfa,
      tenantActive: result.context.tenantActive,
      mfaStatus: result.context.mfaStatus,
    };
  }

  @Post('login/mfa')
  @UseGuards(SessionGuard)
  async loginMfa(
    @CurrentSession() session: AuthSession,
    @Body() input: VerifyMfaDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.completeLoginMfa(
      session,
      input.code,
      this.clientIp(request),
    );
    this.sessions.setCookie(response, result.rawSessionToken);
    return result.context;
  }

  @Post('email/verification/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(
    @Body() input: ResendVerificationDto,
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.resendVerification({
      email: input.email,
      ipAddress: this.clientIp(request),
    });
  }

  @Post('password-reset/request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPasswordReset(
    @Body() input: RequestPasswordResetDto,
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.requestPasswordReset({
      email: input.email,
      ipAddress: this.clientIp(request),
    });
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmPasswordReset(
    @Body() input: ConfirmPasswordResetDto,
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.confirmPasswordReset({
      token: input.token,
      newPassword: input.newPassword,
      ipAddress: this.clientIp(request),
    });
  }

  @Post('email/verification/confirm')
  async confirmEmail(
    @Body() input: VerifyEmailDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.confirmEmail(input.token, {
      ipAddress: this.clientIp(request),
      userAgent: request.get('user-agent') ?? undefined,
    });
    this.sessions.setCookie(response, result.rawSessionToken);
    return result.result;
  }

  @Get('onboarding')
  @UseGuards(SessionGuard, OnboardingGuard)
  onboarding(
    @CurrentSession() session: AuthSession,
    @CurrentAuthorization() context: SessionAuthorizationContext,
  ) {
    return this.auth.onboarding(session, context);
  }

  @Post('mfa/totp/setup')
  @UseGuards(SessionGuard)
  async setupTotp(
    @CurrentSession() session: AuthSession,
    @CurrentAuthorization() context: SessionAuthorizationContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.auth.setupMfa(session, context);
  }

  @Post('mfa/totp/verify')
  @UseGuards(SessionGuard)
  async verifyTotp(
    @CurrentSession() session: AuthSession,
    @Body() input: VerifyMfaDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.verifyMfa(
      session,
      input.code,
      this.clientIp(request),
    );
    this.sessions.setCookie(response, result.rawSessionToken);
    return result.context;
  }

  @Post('mfa/totp/disable')
  @UseGuards(SessionGuard)
  async disableTotp(
    @CurrentSession() session: AuthSession,
    @Body() input: DisableMfaDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.disableMfa(
      session,
      input,
      this.clientIp(request),
    );
    this.sessions.setCookie(response, result.rawSessionToken);
    return result.context;
  }

  @Get('session')
  @UseGuards(SessionGuard)
  session(@CurrentAuthorization() context: SessionAuthorizationContext) {
    return this.auth.sessionDetails(context);
  }

  @Delete('session')
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentSession() session: AuthSession,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(session);
    this.sessions.clearCookie(response);
  }

  @Patch('session/organization')
  // Selecting the first tenant is valid when the session has no active tenant yet.
  @UseGuards(SessionGuard)
  changeOrganization(
    @CurrentSession() session: AuthSession,
    @Body() input: ChangeOrganizationDto,
  ) {
    return this.auth.changeOrganization(session, input.organizationId);
  }

  private clientIp(request: Request): string {
    return request.ip || request.socket.remoteAddress || 'unknown';
  }
}
