import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

@Injectable()
export class PasswordService {
  constructor(private readonly config: ConfigService) {}

  hash(password: string): Promise<string> {
    return bcrypt.hash(
      password,
      this.config.getOrThrow<number>('auth.passwordSaltRounds'),
    );
  }

  verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
