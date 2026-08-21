import { NestFactory } from '@nestjs/core';
import { EmailWorkerModule } from './email-worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(EmailWorkerModule);
  app.enableShutdownHooks();
}

void bootstrap();
