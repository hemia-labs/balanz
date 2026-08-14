import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import {
  getDatabaseConfig,
  getDatabaseOptions,
} from '../config/database.config';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

export const AppDataSource = new DataSource(
  getDatabaseOptions(getDatabaseConfig()),
);
