import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { MfaProviderPort } from './ports/mfa-provider.port';

@Injectable()
export class StubMfaProvider implements MfaProviderPort {
  private readonly code: Buffer;

  constructor(config: ConfigService) {
    const nodeEnv = config.get<string>('app.nodeEnv', 'development');
    if (nodeEnv === 'production') {
      throw new Error('MFA_PROVIDER=stub is not allowed in production');
    }
    this.code = Buffer.from(config.get<string>('auth.mfaStubCode', '000000'));
  }

  setup(): Promise<{
    providerReference: string;
    factorType: 'provider_mfa';
  }> {
    return Promise.resolve({
      providerReference: `stub:${randomUUID()}`,
      factorType: 'provider_mfa',
    });
  }

  verify(providerReference: string, code: string): Promise<boolean> {
    if (!providerReference.startsWith('stub:')) return Promise.resolve(false);
    const candidate = Buffer.from(code);
    return Promise.resolve(
      candidate.length === this.code.length &&
        timingSafeEqual(candidate, this.code),
    );
  }

  revoke(): Promise<void> {
    return Promise.resolve();
  }
}
