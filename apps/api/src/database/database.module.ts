import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SecretsService } from '@hemia/secrets/nestjs';
import { DatabaseConfig, getDatabaseOptions } from '../config/database.config';
import { SecretsModule } from '../modules/secrets/secrets.module';
import { isDatabaseSecret, type DatabaseSecret } from './types/database.types';

@Module({
  imports: [
    SecretsModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule, SecretsModule],
      inject: [ConfigService, SecretsService],
      useFactory: async (config: ConfigService, secrets: SecretsService) => {
        const database = config.getOrThrow<DatabaseConfig>('database');
        const options = getDatabaseOptions(database);

        if (!config.get<boolean>('secrets.enabled', false)) {
          return options;
        }

        const secret =
          await secrets.getRequired<DatabaseSecret>('database/postgres');
        if (!isDatabaseSecret(secret)) {
          throw new Error(
            'Secret database/postgres must contain db_host, db_port, db_username, db_password, db_database and db_logging',
          );
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
      },
    }),
  ],
})
export class DatabaseModule {}
