import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BILLING_CHECKOUT_SCOPES,
  type BillingIdentityConfig,
} from '../../config/billing-identity.config';

@Injectable()
export class BillingIdentityService {
  private cached?: { token: string; refreshAt: number };
  private pending?: Promise<string>;

  constructor(private readonly config: ConfigService) {}

  getAccessToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.refreshAt) {
      return Promise.resolve(this.cached.token);
    }
    this.pending ??= this.requestToken().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async requestToken(): Promise<string> {
    const settings =
      this.config.getOrThrow<BillingIdentityConfig>('billingIdentity');
    if (!settings.tokenUrl || !settings.clientSecret) {
      throw new ServiceUnavailableException(
        'Configure BILLING_IDENTITY_TOKEN_URL y BILLING_CLIENT_SECRET en el API de Balanz.',
      );
    }
    const startedAt = Date.now();
    try {
      const response = await fetch(settings.tokenUrl, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(settings.timeoutMs),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          scope: BILLING_CHECKOUT_SCOPES.join(' '),
        }),
      });
      if (!response.ok) throw new Error('Identity token request rejected');
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new Error('Invalid token response');
      const token = body as Record<string, unknown>;
      if (
        typeof token.access_token !== 'string' ||
        !/^[A-Za-z0-9._~-]+$/.test(token.access_token) ||
        token.token_type !== 'Bearer' ||
        typeof token.expires_in !== 'number' ||
        !Number.isInteger(token.expires_in) ||
        token.expires_in <= 0 ||
        token.expires_in > 600 ||
        typeof token.scope !== 'string' ||
        !BILLING_CHECKOUT_SCOPES.every((scope) =>
          (token.scope as string).split(/\s+/).includes(scope),
        )
      )
        throw new Error('Invalid service token response');
      this.cached = {
        token: token.access_token,
        refreshAt: startedAt + Math.max(0, token.expires_in - 30) * 1_000,
      };
      return this.cached.token;
    } catch {
      // Never propagate provider bodies or fetch errors containing credentials.
      throw new ServiceUnavailableException(
        'No se pudo autenticar Balanz con Identity para Billing.',
      );
    }
  }
}
