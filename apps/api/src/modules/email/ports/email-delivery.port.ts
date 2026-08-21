export const EMAIL_DELIVERY_PORT = Symbol('EMAIL_DELIVERY_PORT');

export interface EmailDeliveryPort {
  sendVerification(input: {
    email: string;
    firstName?: string;
    token: string;
    expiresAt: Date;
  }): Promise<void>;
}
