import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JWT_SECRETS, type JwtSecrets } from './types/jwt.types';

@Injectable()
export class PasswordService {
  constructor(@Inject(JWT_SECRETS) private readonly secrets: JwtSecrets) {}

  hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.secrets.bcrypt_salt_rounds);
  }

  verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
