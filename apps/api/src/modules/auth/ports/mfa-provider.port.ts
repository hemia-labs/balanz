export const MFA_PROVIDER = Symbol('MFA_PROVIDER');

export interface MfaProviderPort {
  setup(userId: string): Promise<{
    providerReference: string;
    factorType: 'provider_mfa';
  }>;
  verify(providerReference: string, code: string): Promise<boolean>;
  revoke(providerReference: string): Promise<void>;
}
