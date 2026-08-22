import { Injectable } from '@nestjs/common';

type Otplib = {
  generateSecret: (options?: { length?: number }) => string;
  generateURI: (options: {
    issuer: string;
    label: string;
    secret: string;
    algorithm: 'sha1';
    digits: 6;
    period: 30;
  }) => string;
  verify: (
    options: Record<string, unknown>,
  ) => Promise<{ valid: boolean; timeStep?: number }>;
};

const ISSUER = 'Balanz';
const PERIOD = 30;
const DIGITS = 6;
const ALGORITHM = 'sha1' as const;

@Injectable()
export class TotpService {
  private library?: Promise<Otplib>;

  async setup(email: string): Promise<{ secret: string; otpauthUri: string }> {
    const { generateSecret, generateURI } = await this.load();
    const secret = generateSecret({ length: 20 });
    return {
      secret,
      otpauthUri: generateURI({
        issuer: ISSUER,
        label: email,
        secret,
        algorithm: ALGORITHM,
        digits: DIGITS,
        period: PERIOD,
      }),
    };
  }

  async verify(
    secret: string,
    code: string,
    lastUsedCounter?: string | null,
    epoch = Math.floor(Date.now() / 1000),
  ): Promise<{
    valid: boolean;
    timeStep?: number;
  }> {
    const { verify } = await this.load();
    const result = await verify({
      secret,
      token: code,
      algorithm: ALGORITHM,
      digits: DIGITS,
      period: PERIOD,
      epoch,
      epochTolerance: 30,
      ...(lastUsedCounter ? { afterTimeStep: Number(lastUsedCounter) } : {}),
    });
    return result.valid && 'timeStep' in result
      ? { valid: true, timeStep: result.timeStep }
      : { valid: false };
  }

  private load(): Promise<Otplib> {
    this.library ??= import('otplib') as unknown as Promise<Otplib>;
    return this.library;
  }
}
