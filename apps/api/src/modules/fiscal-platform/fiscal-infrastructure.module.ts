import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ObservabilityModule } from '../../common/observability/observability.module';
import { FiscalMetricsService } from '../../common/observability/fiscal-metrics.service';
import type { FiscalPlatformConfig } from '../../config/fiscal-platform.config';
import {
  ObjectStorageModule,
  type ObjectStorageModuleOptions,
} from '../object-storage';
import {
  MalwareScannerModule,
  type MalwareScannerModuleOptions,
} from '../malware-scanner';

function storageOptions(
  config: ConfigService,
  metrics: FiscalMetricsService,
): ObjectStorageModuleOptions {
  const fiscal = config.getOrThrow<FiscalPlatformConfig>('fiscalPlatform');
  const { storage, limits, environment } = fiscal;
  if (storage.driver === 'local') {
    return {
      driver: 'local',
      rootDirectory: storage.localRoot,
      maxBytes: limits.zipBytes,
      keyPrefix: 'objects',
      nodeEnv: environment as 'development' | 'test' | 'production',
      windowsPermissionsMode: storage.localWindowsPresecured
        ? 'presecured-root'
        : 'reject',
      metrics,
    };
  }

  if (!storage.s3.bucket) {
    throw new Error('S3_BUCKET is required for the configured storage driver');
  }
  const credentials =
    storage.s3.accessKeyId && storage.s3.secretAccessKey
      ? {
          accessKeyId: storage.s3.accessKeyId,
          secretAccessKey: storage.s3.secretAccessKey,
        }
      : undefined;
  return {
    driver: 's3',
    region: storage.s3.region,
    bucket: storage.s3.bucket,
    endpoint: storage.s3.endpoint,
    forcePathStyle: storage.s3.forcePathStyle,
    allowInsecureEndpoint: environment !== 'production',
    credentials,
    serverSideEncryption: storage.s3.encryption,
    kmsKeyId: storage.s3.kmsKeyId,
    signedUrlTtlSeconds: storage.signedUrlTtlSeconds,
    requestTimeoutMs: storage.s3.requestTimeoutMs,
    connectionTimeoutMs: storage.s3.requestTimeoutMs,
    maxBytes: limits.zipBytes,
    keyPrefix: 'objects',
    metrics,
  };
}

function scannerOptions(
  config: ConfigService,
  metrics: FiscalMetricsService,
): MalwareScannerModuleOptions {
  const fiscal = config.getOrThrow<FiscalPlatformConfig>('fiscalPlatform');
  const { scanner, environment } = fiscal;
  if (scanner.mode === 'bypass') {
    return {
      driver: 'development-bypass',
      nodeEnv: environment as 'development' | 'test' | 'production',
      explicitlyEnabled: true,
      maxBytes: scanner.maxStreamBytes,
      metrics,
    };
  }
  return {
    driver: 'clamav',
    host: scanner.host,
    port: scanner.port,
    connectTimeoutMs: scanner.connectTimeoutMs,
    scanTimeoutMs: scanner.scanTimeoutMs,
    maxBytes: scanner.maxStreamBytes,
    metrics,
  };
}

const configuredStorage = ObjectStorageModule.registerAsync({
  imports: [ConfigModule, ObservabilityModule],
  inject: [ConfigService, FiscalMetricsService],
  useFactory: storageOptions,
});

const configuredScanner = MalwareScannerModule.registerAsync({
  imports: [ConfigModule, ObservabilityModule],
  inject: [ConfigService, FiscalMetricsService],
  useFactory: scannerOptions,
});

@Module({
  imports: [configuredStorage, configuredScanner],
  exports: [configuredStorage, configuredScanner],
})
export class FiscalInfrastructureModule {}
