import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import appConfig from './config/app.config';
import authConfig from './config/auth.config';
import cookiesConfig from './config/cookies.config';
import databaseConfig from './config/database.config';
import emailConfig from './config/email.config';
import redisConfig from './config/redis.config';
import secretsConfig from './config/secrets.config';
import { envVarsSchema } from './config/env.validation';
import { AuthModule as CommonAuthModule } from './common/auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { UsersModule } from './modules/users/users.module';
import { SecretsModule } from './modules/secrets/secrets.module';
import { AuthModule as FeatureAuthModule } from './modules/auth/auth.module';

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
        emailConfig,
        redisConfig,
        secretsConfig,
      ],
      validationSchema: envVarsSchema,
      validationOptions: { allowUnknown: true, abortEarly: true },
    }),
    CommonAuthModule,
    SecretsModule,
    DatabaseModule,
    UsersModule,
    FeatureAuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
