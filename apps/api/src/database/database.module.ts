import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  DatabaseConfig,
  getDatabaseOptions,
} from '../config/database.config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        getDatabaseOptions(config.getOrThrow<DatabaseConfig>('database')),
    }),
  ],
})
export class DatabaseModule {}
