import appConfig from '../src/config/app.config';
import {
  apiEnvVarsSchema,
  workerEnvVarsSchema,
} from '../src/config/env.validation';

describe('API bind address', () => {
  const original = process.env.APP_HOST;
  afterEach(() => {
    if (original === undefined) delete process.env.APP_HOST;
    else process.env.APP_HOST = original;
  });

  it('keeps PM2 bound to loopback by default', () => {
    delete process.env.APP_HOST;
    expect(appConfig().host).toBe('127.0.0.1');
  });

  it('supports binding the API inside a container', () => {
    process.env.APP_HOST = '0.0.0.0';
    expect(appConfig().host).toBe('0.0.0.0');
    expect(
      apiEnvVarsSchema.extract('APP_HOST').validate('0.0.0.0').error,
    ).toBeUndefined();
  });

  it('rejects invalid bind addresses and API settings in the worker', () => {
    expect(
      apiEnvVarsSchema.extract('APP_HOST').validate('https://example.com')
        .error,
    ).toBeDefined();
    expect(
      workerEnvVarsSchema.extract('APP_HOST').validate('0.0.0.0').error,
    ).toBeDefined();
  });
});
