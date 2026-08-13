import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PasswordService } from './password.service';

/**
 * Registra JwtModule globalmente para que JwtAuthGuard pueda inyectar JwtService
 * en cualquier módulo sin re-importarlo. Los guards se aplican por controller
 * con `@UseGuards(JwtAuthGuard, PermissionsGuard)`.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // Solo verificación aquí; la firma (login/refresh) definirá signOptions al emitir.
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('auth.jwtSecret'),
      }),
    }),
  ],
  providers: [JwtAuthGuard, PermissionsGuard, PasswordService],
  exports: [JwtModule, JwtAuthGuard, PermissionsGuard, PasswordService],
})
export class AuthModule {}
