import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { getCorsOptions } from '../src/config/app.config';
import { envVarsSchema } from '../src/config/env.validation';

const requiredEnv = {
  DB_HOST: 'localhost',
  DB_PORT: 5432,
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_DATABASE: 'balanz_test',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  BCRYPT_SALT_ROUNDS: 10,
};

describe('CORS', () => {
  it('requires APP_CORS_ORIGINS in production', () => {
    const { error } = envVarsSchema.validate({
      ...requiredEnv,
      NODE_ENV: 'production',
      APP_CORS_ORIGINS: '',
    });

    expect(error?.message).toContain('APP_CORS_ORIGINS');
  });

  it('allows a configured origin and rejects an unconfigured origin', async () => {
    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();
    const app = module.createNestApplication();

    app.enableCors(getCorsOptions('production', ['https://allowed.example']));
    await app.init();

    const server = app.getHttpServer();
    const allowed = await request(server)
      .get('/')
      .set('Origin', 'https://allowed.example');
    const rejected = await request(server)
      .get('/')
      .set('Origin', 'https://rejected.example');

    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://allowed.example',
    );
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();

    await app.close();
  });
});
