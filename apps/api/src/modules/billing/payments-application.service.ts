import {
  ForbiddenException,
  Injectable,
  Module,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { Request } from 'express';
import type {
  LegalContextInput,
  LegalContextResult,
  PaymentsContext,
  PaymentsOperation,
} from '@hemia/payments/nestjs';
import { SessionGuard } from '../../common/guards/session.guard';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PaymentsSnapshotService } from './payments-snapshot.service';
import { AuthorizationService } from '../sessions/authorization.service';
import { SessionsModule } from '../sessions/sessions.module';
import {
  AuthSession,
  AuthSessionStatus,
} from '../sessions/entities/auth-session.entity';
import {
  Membership,
  MembershipStatus,
} from '../memberships/entities/membership.entity';
import { Organization } from '../organizations/entities/organization.entity';
import paymentsConfig, {
  type PaymentsSettings,
} from '../../config/payments.config';

/** Only Balanz session, contracting and tenant rules; payment authority and attempt storage belong to Billing. */
@Injectable()
export class PaymentsApplicationService {
  constructor(
    private readonly config: ConfigService,
    private readonly db: DataSource,
    private readonly auth: AuthorizationService,
    private readonly sessions: SessionGuard,
    private readonly tenants: TenantAccessGuard,
    private readonly permissions: PermissionsGuard,
  ) {}

  async authorize(
    input: unknown,
    operation: PaymentsOperation,
  ): Promise<PaymentsContext> {
    const request = input as Request;
    await this.sessions.authorizeRequest(request);
    if (!this.tenants.authorizeRequest(request))
      throw new ForbiddenException('Active tenant required');
    if (operation !== 'license.read')
      await this.permissions.authorizeRequest(request, ['billing.manage']);
    const session = request.authSession!;
    if (!session.organizationId || !session.membershipId)
      throw new ForbiddenException('Organización activa requerida.');
    return {
      organizationId: session.organizationId,
      subjectId: session.userId,
      sessionId: session.id,
      membershipId: session.membershipId,
    };
  }

  async returnUrls(context: PaymentsContext, attemptId: string) {
    const connection =
      this.config.getOrThrow<PaymentsSettings>('payments').connection;
    if (!connection?.successUrl || !connection.cancelUrl)
      throw new ServiceUnavailableException(
        'Configura las URLs de retorno de pagos.',
      );
    const organization = await this.db.getRepository(Organization).findOne({
      where: { id: context.organizationId },
      select: { slug: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    const path = `/es/organizations/${encodeURIComponent(organization.slug)}/checkout`;
    const success = new URL(`${path}/success`, connection.successUrl);
    const cancel = new URL(`${path}/cancel`, connection.cancelUrl);
    success.searchParams.set('attemptId', attemptId);
    cancel.searchParams.set('attemptId', attemptId);
    return { successUrl: success.href, cancelUrl: cancel.href };
  }

  async resolveLegalContext(
    dto: LegalContextInput,
  ): Promise<LegalContextResult> {
    let session: AuthSession;
    if (dto.purpose === 'acceptance') {
      if (!dto.sessionId)
        throw new ForbiddenException('Verified session required');
      const found = await this.db.getRepository(AuthSession).findOne({
        where: {
          id: dto.sessionId,
          userId: dto.subjectId,
          organizationId: dto.organizationId,
          status: AuthSessionStatus.ACTIVE,
        },
      });
      const idle =
        this.config.get<number>('auth.sessionIdleTtlSeconds', 1800) * 1000;
      if (
        !found ||
        found.expiresAt.getTime() <= Date.now() ||
        found.lastActivityAt.getTime() + idle <= Date.now() ||
        !found.requiresMfa ||
        !found.mfaVerifiedAt
      )
        throw new ForbiddenException('Verified active session required');
      session = found;
    } else {
      const membership = await this.db.getRepository(Membership).findOne({
        where: {
          userId: dto.subjectId,
          organizationId: dto.organizationId,
          status: MembershipStatus.ACTIVE,
        },
      });
      if (!membership)
        throw new ForbiddenException('Active membership required');
      // Recompute current permissions without reviving the historical buyer session.
      session = Object.assign(new AuthSession(), {
        userId: dto.subjectId,
        organizationId: dto.organizationId,
        membershipId: membership.id,
        status: AuthSessionStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 1000),
        requiresMfa: false,
      });
    }
    const context = await this.auth.resolve(session);
    if (!context.membershipId)
      throw new ForbiddenException('Active membership required');
    return {
      subjectId: dto.subjectId,
      organizationId: dto.organizationId,
      membershipId: context.membershipId,
      roles: context.role ? [context.role] : [],
      canContract:
        context.tenantActive &&
        context.permissions.includes('billing.manage') &&
        (dto.purpose !== 'acceptance' || context.mfaStatus === 'active'),
    };
  }
}

@Module({
  imports: [SessionsModule, ConfigModule.forFeature(paymentsConfig)],
  providers: [
    PaymentsApplicationService,
    SessionGuard,
    TenantAccessGuard,
    PaymentsSnapshotService,
  ],
  exports: [PaymentsApplicationService, PaymentsSnapshotService],
})
export class PaymentsApplicationModule {}
