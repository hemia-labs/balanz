import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { getCorsOptions } from './config/app.config';
import { validationExceptionFactory } from './common/validation/validation-exception.factory';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const trustProxyHops = config.get<number>('app.trustProxyHops', 0);
  if (trustProxyHops > 0) {
    const expressInstance = app.getHttpAdapter().getInstance() as {
      set(setting: string, value: number): void;
    };
    expressInstance.set('trust proxy', trustProxyHops);
  }

  app.use(cookieParser());

  app.setGlobalPrefix(config.get<string>('app.globalPrefix') ?? 'api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const nodeEnv = config.get<string>('app.nodeEnv') ?? 'development';
  const corsOrigins = config.get<string[]>('app.corsOrigins') ?? [];
  app.enableCors(getCorsOptions(nodeEnv, corsOrigins));

  await app.listen(config.get<number>('app.port') ?? 3001);
}
void bootstrap();
