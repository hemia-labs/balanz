import {
  type DynamicModule,
  type FactoryProvider,
  type ModuleMetadata,
  Module,
} from '@nestjs/common';
import {
  LocalFilesystemObjectStorageAdapter,
  type LocalFilesystemObjectStorageOptions,
} from './adapters/local-filesystem/local-filesystem-object-storage.adapter';
import {
  S3ObjectStorageAdapter,
  type S3ObjectStorageOptions,
} from './adapters/s3/s3-object-storage.adapter';
import {
  OBJECT_STORAGE_OPTIONS,
  OBJECT_STORAGE_PORT,
} from './object-storage.tokens';
import type { ObjectStoragePort } from './ports/object-storage.port';
import { OpaqueObjectKeyFactory } from './services/opaque-object-key.factory';
import type { FiscalMetricsService } from '../../common/observability/fiscal-metrics.service';
import { InstrumentedObjectStorageAdapter } from './services/instrumented-object-storage.adapter';

export type ObjectStorageModuleOptions = (
  LocalFilesystemObjectStorageOptions | S3ObjectStorageOptions
) & { metrics?: FiscalMetricsService };

export interface ObjectStorageModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  inject?: FactoryProvider['inject'];
  useFactory: FactoryProvider<ObjectStorageModuleOptions>['useFactory'];
}

@Module({})
export class ObjectStorageModule {
  static register(options: ObjectStorageModuleOptions): DynamicModule {
    return this.registerAsync({ useFactory: () => options });
  }

  static registerAsync(
    options: ObjectStorageModuleAsyncOptions,
  ): DynamicModule {
    return {
      module: ObjectStorageModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: OBJECT_STORAGE_OPTIONS,
          inject: options.inject ?? [],
          useFactory: options.useFactory,
        },
        {
          provide: OpaqueObjectKeyFactory,
          inject: [OBJECT_STORAGE_OPTIONS],
          useFactory: (storageOptions: ObjectStorageModuleOptions) =>
            new OpaqueObjectKeyFactory(storageOptions.keyPrefix),
        },
        {
          provide: OBJECT_STORAGE_PORT,
          inject: [OBJECT_STORAGE_OPTIONS, OpaqueObjectKeyFactory],
          useFactory: (
            storageOptions: ObjectStorageModuleOptions,
            keyFactory: OpaqueObjectKeyFactory,
          ): ObjectStoragePort => {
            const adapter =
              storageOptions.driver === 'local'
                ? new LocalFilesystemObjectStorageAdapter(
                    storageOptions,
                    keyFactory,
                  )
                : new S3ObjectStorageAdapter(storageOptions, keyFactory);
            return storageOptions.metrics
              ? new InstrumentedObjectStorageAdapter(
                  adapter,
                  storageOptions.driver,
                  storageOptions.metrics,
                )
              : adapter;
          },
        },
      ],
      exports: [OBJECT_STORAGE_PORT, OpaqueObjectKeyFactory],
    };
  }
}
