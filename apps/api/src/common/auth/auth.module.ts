import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SecretsService } from '@hemia/secrets/nestjs';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SecretsModule } from '../../modules/secrets/secrets.module';
import { JWT_SECRETS, isJwtSecrets, type JwtSecrets } from './types/jwt.types';
import { PasswordService } from './password.service';
import { AuditModule } from '../../modules/audit/audit.module';

@Global()
@Module({
  imports: [ConfigModule, SecretsModule, AuditModule],
  providers: [
    {
      provide: JWT_SECRETS,
      inject: [ConfigService, SecretsService],
      useFactory: async (
        config: ConfigService,
        secrets: SecretsService,
      ): Promise<JwtSecrets> => {
        if (!config.get<boolean>('secrets.enabled', false)) {
          return {
            bcrypt_salt_rounds: config.getOrThrow<number>(
              'auth.passwordSaltRounds',
            ),
            cookie_secure: config.getOrThrow<boolean>('cookies.secure'),
            jwt_expires_in: config.getOrThrow<string>('auth.jwtExpiresIn'),
            jwt_refresh_expires_in: config.getOrThrow<string>(
              'auth.refreshExpiresIn',
            ),
            jwt_refresh_secret: config.getOrThrow<string>('auth.refreshSecret'),
            jwt_secret: config.getOrThrow<string>('auth.jwtSecret'),
          };
        }

        const secret = await secrets.getRequired<JwtSecrets>('auth/jwt');
        if (!isJwtSecrets(secret)) {
          throw new Error(
            'Secret auth/jwt must contain bcrypt_salt_rounds, cookie_secure, jwt_expires_in, jwt_refresh_expires_in, jwt_refresh_secret and jwt_secret',
          );
        }

        return secret;
      },
    },
    PermissionsGuard,
    PasswordService,
  ],
  exports: [AuditModule, PermissionsGuard, JWT_SECRETS, PasswordService],
})
export class AuthModule {}
