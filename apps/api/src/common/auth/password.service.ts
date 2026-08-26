import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JWT_SECRETS, type JwtSecrets } from './types/jwt.types';

const BCRYPT_MAX_PASSWORD_BYTES = 72;

@Injectable()
export class PasswordService {
  constructor(@Inject(JWT_SECRETS) private readonly secrets: JwtSecrets) {}

  hash(password: string): Promise<string> {
    if (this.isTooLong(password)) {
      throw new BadRequestException('Password must not exceed 72 bytes');
    }
    return bcrypt.hash(password, this.secrets.bcrypt_salt_rounds);
  }

  verify(password: string, hash: string): Promise<boolean> {
    if (this.isTooLong(password)) return Promise.resolve(false);
    return bcrypt.compare(password, hash);
  }

  private isTooLong(password: string): boolean {
    return Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_PASSWORD_BYTES;
  }
}
