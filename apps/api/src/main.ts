import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { getCorsOptions } from './config/app.config';
import { init } from '@hemia/horus';
import type { HorusConfig } from './config/horus.config';
import { API_VALIDATION_PIPE_OPTIONS } from './common/validation/validation-exception.factory';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const horus = config.get<HorusConfig>('horus');
  if (horus?.endpoint && horus.key) {
    init({
      endpoint: horus.endpoint,
      key: horus.key,
      release: horus.release,
      timeoutMs: horus.timeoutMs,
      captureConsole: false,
    });
  }
  const trustProxyHops = config.get<number>('app.trustProxyHops', 0);
  if (trustProxyHops > 0) {
    const expressInstance = app.getHttpAdapter().getInstance() as {
      set(setting: string, value: number): void;
    };
    expressInstance.set('trust proxy', trustProxyHops);
  }

  app.use(cookieParser());

  app.setGlobalPrefix(config.get<string>('app.globalPrefix') ?? 'api/v1', {
    exclude: [
      { path: 'liveness', method: RequestMethod.GET },
      { path: 'readiness', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(new ValidationPipe(API_VALIDATION_PIPE_OPTIONS));
  app.useGlobalFilters(new AllExceptionsFilter());

  const nodeEnv = config.get<string>('app.nodeEnv') ?? 'development';
  const corsOrigins = config.get<string[]>('app.corsOrigins') ?? [];
  app.enableCors(getCorsOptions(nodeEnv, corsOrigins));
  app.enableShutdownHooks();

  await app.listen(config.get<number>('app.port') ?? 3021, '127.0.0.1');
}
void bootstrap();
