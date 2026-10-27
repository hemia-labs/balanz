import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Post,
  HttpCode,
  Header,
  Injectable,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PaymentsService,
  type LicenseAccess,
  type PaymentsContext,
} from '@hemia/payments/nestjs';
import type { Request } from 'express';
import { FiscalTenantTransactionService } from '../../database/rls/fiscal-tenant-transaction.service';
import { PaymentsApplicationService } from './payments-application.service';
import { PaymentsSnapshotService } from './payments-snapshot.service';
import {
  localPaidAccess,
  localRenewalAt,
  type LocalPaymentsRow,
} from './payments-local-access';

type Trial = { status: string; trial_ends_at: Date | string | null };
export type PaymentsAccess = Omit<LicenseAccess, 'source' | 'reason'> & {
  source: LicenseAccess['source'] | 'trial';
  reason: LicenseAccess['reason'] | 'trial_active' | 'trial_expired';
  renewalAt?: string | null;
};

export function withTrial(
  paid: LicenseAccess,
  trial?: Trial,
  now = Date.now(),
): PaymentsAccess {
  if (paid.active) return paid;
  const trialEnd = trial?.trial_ends_at
    ? new Date(trial.trial_ends_at).getTime()
    : null;
  if (trial?.status === 'trialing' && trialEnd !== null && trialEnd > now)
    return {
      ...paid,
      active: true,
      source: 'trial',
      validUntil: new Date(trialEnd).toISOString(),
      reason: 'trial_active',
      entitlements: {},
    };
  return {
    ...paid,
    reason:
      paid.reason === 'not_confirmed' && trialEnd !== null
        ? 'trial_expired'
        : paid.reason,
  };
}

@Injectable()
export class PaymentsAccessService {
  constructor(
    private readonly payments: PaymentsService,
    private readonly transactions: FiscalTenantTransactionService,
    private readonly snapshots: PaymentsSnapshotService,
  ) {}
  async get(context: PaymentsContext): Promise<PaymentsAccess> {
    if (!context.membershipId)
      throw new UnauthorizedException('Active membership required');
    const product = this.payments.options.connection.productCode;
    const rows = await this.transactions.run(
      {
        organizationId: context.organizationId,
        membershipId: context.membershipId,
      },
      (manager) =>
        manager.query<LocalPaymentsRow[]>(
          `SELECT l.revision::text AS revision,l.license,l.subscription,l.snapshot_version,l.confirmed_at,
                s.status AS trial_status,s.trial_ends_at
         FROM memberships m JOIN organizations o ON o.id=m.organization_id
         LEFT JOIN public.payments_licenses l ON l.organization_id=m.organization_id AND l.product_code=$4
         LEFT JOIN subscriptions s ON s.organization_id=m.organization_id
         WHERE m.organization_id=$1 AND m.id=$2 AND m.user_id=$3 AND m.status='active' AND o.status='active'`,
          [
            context.organizationId,
            context.membershipId,
            context.subjectId,
            product,
          ],
        ),
    );
    if (!rows[0]) throw new UnauthorizedException('Active membership required');
    const paid = localPaidAccess(rows[0], context.organizationId, product);
    if (paid.active)
      return { ...paid, renewalAt: localRenewalAt(rows[0], paid) };
    return withTrial(paid, {
      status: rows[0].trial_status ?? '',
      trial_ends_at: rows[0].trial_ends_at,
    });
  }
  async sync(context: PaymentsContext): Promise<PaymentsAccess> {
    await this.get(context);
    const snapshot = await this.payments.getSnapshot(context);
    await this.snapshots.apply(snapshot, context.organizationId);
    return this.get(context);
  }
  async assert(context: PaymentsContext) {
    const access = await this.get(context);
    if (!access.active)
      throw new ForbiddenException({
        code: 'BILLING_ACCESS_REQUIRED',
        message:
          'Se requiere una prueba o suscripción vigente para iniciar operaciones fiscales.',
        reason: access.reason,
      });
  }
}

@Injectable()
export class BillingAccessGuard implements CanActivate {
  constructor(private readonly access: PaymentsAccessService) {}
  async canActivate(context: ExecutionContext) {
    const session = context.switchToHttp().getRequest<Request>().authSession;
    if (!session?.organizationId || !session.membershipId)
      throw new UnauthorizedException('Session context required');
    await this.access.assert({
      organizationId: session.organizationId,
      membershipId: session.membershipId,
      subjectId: session.userId,
      sessionId: session.id,
    });
    return true;
  }
}

@Controller('payments')
export class PaymentsAccessController {
  constructor(
    private readonly application: PaymentsApplicationService,
    private readonly access: PaymentsAccessService,
  ) {}
  @Post('sync')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async sync(@Req() request: Request) {
    return this.access.sync(
      await this.application.authorize(request, 'license.read'),
    );
  }

  @Get('access')
  @Header('Cache-Control', 'no-store')
  async get(@Req() request: Request) {
    return this.access.get(
      await this.application.authorize(request, 'license.read'),
    );
  }
}
