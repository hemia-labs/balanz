export const EMAIL_DELIVERY_PORT = Symbol('EMAIL_DELIVERY_PORT');

export interface EmailDeliveryPort {
  sendVerification(input: {
    email: string;
    firstName?: string;
    token: string;
  }): Promise<void>;

  sendWelcome(input: {
    email: string;
    firstName?: string;
    organizationName: string;
    locale?: string;
    timezone?: string;
    trialEndsAt: Date;
  }): Promise<void>;

  sendMfaEnabled(input: {
    email: string;
    firstName?: string;
    mfaStatus: string;
    mfaMethod: string;
    activatedAt: Date;
    deviceName: string;
    locale?: string;
    timezone?: string;
  }): Promise<void>;

  sendMfaDisabled(input: {
    email: string;
    firstName?: string;
    mfaStatus: string;
    mfaMethod: string;
    activatedAt: Date;
    deviceName: string;
    locale?: string;
    timezone?: string;
  }): Promise<void>;
}
