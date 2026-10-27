import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { init } from '@hemia/horus';
import type { FiscalPlatformConfig } from './config/fiscal-platform.config';
import type { HorusConfig } from './config/horus.config';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(WorkerModule);
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

  const worker =
    config.getOrThrow<FiscalPlatformConfig>('fiscalPlatform').worker;
  app.enableShutdownHooks();
  await app.listen(worker.healthPort, worker.healthHost);
}

void bootstrap();
