import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecretsService } from '@hemia/secrets/nestjs';
import {
  type DatabaseConfig,
  getDatabaseOptions,
} from '../config/database.config';
import { SecretsModule } from '../modules/secrets/secrets.module';
import { isDatabaseSecret, type DatabaseSecret } from './types/database.types';
import {
  DATABASE_RUNTIME_PRINCIPAL,
  type DatabaseRuntimePrincipal,
  RuntimeDatabaseGuard,
} from './runtime-database-guard.service';

function runtimeEnvironmentConfig(
  database: DatabaseConfig,
  principal: DatabaseRuntimePrincipal,
): DatabaseConfig {
  const username =
    principal === 'api' ? database.apiUsername : database.workerUsername;
  const password =
    principal === 'api' ? database.apiPassword : database.workerPassword;
  if (!username || !password) {
    throw new Error(
      `Dedicated DB_${principal.toUpperCase()}_USERNAME/PASSWORD runtime credentials are required`,
    );
  }
  if (username === database.username) {
    throw new Error('The PostgreSQL migrator login cannot be a runtime login');
  }
  return { ...database, username, password };
}

type RequiredDatabaseSecretReader = Pick<SecretsService, 'getRequired'>;

export async function resolveRuntimeDatabaseOptions(
  database: DatabaseConfig,
  secretsEnabled: boolean,
  secrets: RequiredDatabaseSecretReader,
  principal: DatabaseRuntimePrincipal,
  configuredProfile: DatabaseRuntimePrincipal,
) {
  if (configuredProfile !== principal) {
    throw new Error(
      `Runtime configuration profile ${configuredProfile} cannot initialize ${principal}`,
    );
  }
  if (!secretsEnabled) {
    return getDatabaseOptions(runtimeEnvironmentConfig(database, principal));
  }

  const secret = await secrets.getRequired<DatabaseSecret>(
    `database/postgres-${principal}`,
  );
  if (!isDatabaseSecret(secret)) {
    throw new Error(
      `Secret database/postgres-${principal} must contain a dedicated PostgreSQL runtime login`,
    );
  }
  if (secret.db_username === database.username) {
    throw new Error('The PostgreSQL migrator login cannot be reused');
  }
  return getDatabaseOptions({
    ...database,
    host: secret.db_host,
    port: secret.db_port,
    username: secret.db_username,
    password: secret.db_password,
    name: secret.db_database,
    logging: secret.db_logging,
  });
}

@Module({})
export class DatabaseModule {
  static forRuntime(principal: DatabaseRuntimePrincipal): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        SecretsModule,
        TypeOrmModule.forRootAsync({
          imports: [ConfigModule, SecretsModule],
          inject: [ConfigService, SecretsService],
          useFactory: async (
            config: ConfigService,
            secrets: SecretsService,
          ) => {
            const database = config.getOrThrow<DatabaseConfig>('database');
            return resolveRuntimeDatabaseOptions(
              database,
              config.get<boolean>('secrets.enabled', false),
              secrets,
              principal,
              config.getOrThrow<DatabaseRuntimePrincipal>(
                'secrets.runtimeProfile',
              ),
            );
          },
        }),
      ],
      providers: [
        { provide: DATABASE_RUNTIME_PRINCIPAL, useValue: principal },
        RuntimeDatabaseGuard,
      ],
      exports: [RuntimeDatabaseGuard],
    };
  }
}
