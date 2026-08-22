import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretsService } from '@hemia/secrets/nestjs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;

@Injectable()
export class MfaEncryptionService implements OnModuleInit {
  private keyPromise?: Promise<Buffer>;

  constructor(
    private readonly config: ConfigService,
    private readonly secrets: SecretsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (
      this.config.get<string>('app.nodeEnv', 'development') === 'production'
    ) {
      await this.key();
    }
  }

  async encrypt(value: string): Promise<string> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', await this.key(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  async decrypt(value: string): Promise<string> {
    const [version, ivValue, tagValue, ciphertextValue] = value.split(':');
    if (version !== VERSION || !ivValue || !tagValue || !ciphertextValue) {
      throw new Error('Invalid MFA secret envelope');
    }
    const iv = Buffer.from(ivValue, 'base64url');
    const tag = Buffer.from(tagValue, 'base64url');
    const ciphertext = Buffer.from(ciphertextValue, 'base64url');
    if (
      iv.length !== IV_BYTES ||
      tag.length !== 16 ||
      ciphertext.length === 0
    ) {
      throw new Error('Invalid MFA secret envelope');
    }
    const decipher = createDecipheriv('aes-256-gcm', await this.key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  private key(): Promise<Buffer> {
    this.keyPromise ??= this.loadKey();
    return this.keyPromise;
  }

  private async loadKey(): Promise<Buffer> {
    const configured = this.config.get<string>('auth.mfaEncryptionKey');
    if (configured) return this.decodeKey(configured);

    if (this.config.get<boolean>('secrets.enabled', false)) {
      try {
        const secret =
          await this.secrets.getRequired<Record<string, unknown>>('auth/mfa');
        const value = secret.mfa_encryption_key ?? secret.encryption_key;
        if (typeof value === 'string' && value.length > 0)
          return this.decodeKey(value);
      } catch {
        // Production fails below; local environments can use MFA_ENCRYPTION_KEY.
      }
    }

    if (
      this.config.get<string>('app.nodeEnv', 'development') === 'production'
    ) {
      throw new Error('MFA encryption key is required in production');
    }
    throw new Error('MFA_ENCRYPTION_KEY is required to configure MFA');
  }

  private decodeKey(value: string): Buffer {
    const key = Buffer.from(value, 'base64');
    if (key.length !== KEY_BYTES)
      throw new Error('MFA_ENCRYPTION_KEY must be 32-byte base64');
    return key;
  }
}
