import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SecretsService } from '@hemia/secrets/nestjs';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SecretsModule } from '../../modules/secrets/secrets.module';
import { JWT_SECRETS, isJwtSecrets, type JwtSecrets } from './types/jwt.types';
import { PasswordService } from './password.service';

/**
 * Registra JwtModule globalmente para que JwtAuthGuard pueda inyectar JwtService.
 * Los guards se aplican por controller con `@UseGuards(JwtAuthGuard, PermissionsGuard)`.
 */
@Global()
@Module({
  imports: [ConfigModule, SecretsModule, JwtModule.register({})],
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
    JwtAuthGuard,
    PermissionsGuard,
    PasswordService,
  ],
  exports: [
    JwtModule,
    JwtAuthGuard,
    PermissionsGuard,
    JWT_SECRETS,
    PasswordService,
  ],
})
export class AuthModule {}
