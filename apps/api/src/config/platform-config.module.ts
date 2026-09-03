import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './app.config';
import authConfig from './auth.config';
import cookiesConfig from './cookies.config';
import { databaseConfigForRuntime } from './database.config';
import emailConfig from './email.config';
import {
  envVarsSchemaForRuntime,
  type RuntimeConfigProfile,
} from './env.validation';
import fiscalPlatformConfig from './fiscal-platform.config';
import horusConfig from './horus.config';
import redisConfig from './redis.config';
import { secretsConfigForRuntime } from './secrets.config';

export const RUNTIME_CONFIG_PROFILE = Symbol('RUNTIME_CONFIG_PROFILE');

export function runtimeEnvFilePaths(profile: RuntimeConfigProfile): string[] {
  return [`.env.${profile}.local`, `.env.${profile}`, '.env.local', '.env'];
}

export function ignoreRuntimeEnvFiles(
  environment = process.env.NODE_ENV,
): boolean {
  return environment === 'production';
}

export function runtimeConfigFactories(profile: RuntimeConfigProfile) {
  const sharedFactories = [
    databaseConfigForRuntime(profile),
    redisConfig,
    secretsConfigForRuntime(profile),
    horusConfig,
    fiscalPlatformConfig,
  ];
  return profile === 'api'
    ? [appConfig, ...sharedFactories, authConfig, cookiesConfig, emailConfig]
    : sharedFactories;
}

/** A validated, least-privilege configuration graph for one entrypoint. */
@Global()
@Module({})
export class PlatformConfigModule {
  static forRuntime(profile: RuntimeConfigProfile): DynamicModule {
    return {
      module: PlatformConfigModule,
      global: true,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: runtimeEnvFilePaths(profile),
          ignoreEnvFile: ignoreRuntimeEnvFiles(),
          load: runtimeConfigFactories(profile),
          validationSchema: envVarsSchemaForRuntime(profile),
          validationOptions: { allowUnknown: true, abortEarly: true },
        }),
      ],
      providers: [{ provide: RUNTIME_CONFIG_PROFILE, useValue: profile }],
      exports: [ConfigModule, RUNTIME_CONFIG_PROFILE],
    };
  }
}
