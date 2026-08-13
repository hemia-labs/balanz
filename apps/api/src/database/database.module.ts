import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as path from 'path';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        username: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.name'),
        logging: config.get<boolean>('database.logging'),
        extra: { options: '-c timezone=America/Mexico_City' },
        entities: [
          path.join(__dirname, '..', '**', '*.entity.js'),
          path.join(__dirname, '..', '**', '*.entity.ts'),
        ],
        synchronize: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
