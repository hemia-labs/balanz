import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import appConfig from './config/app.config';
import authConfig from './config/auth.config';
import cookiesConfig from './config/cookies.config';
import databaseConfig from './config/database.config';
import secretsConfig from './config/secrets.config';
import { envVarsSchema } from './config/env.validation';
import { AuthModule } from './common/auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { UsersModule } from './modules/users/users.module';
import { SecretsModule } from './modules/secrets/secrets.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
      load: [
        appConfig,
        databaseConfig,
        authConfig,
        cookiesConfig,
        secretsConfig,
      ],
      validationSchema: envVarsSchema,
      validationOptions: { allowUnknown: true, abortEarly: true },
    }),
    AuthModule,
    SecretsModule,
    DatabaseModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
