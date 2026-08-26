import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  DefaultSecretsClient,
  createSecretsClient,
  InMemorySecretsAdapter,
  PathResolver,
  type SecretsClient,
  type SecretsScope,
} from '@hemia/secrets';
import { HEMIA_SECRETS, SecretsService } from '@hemia/secrets/nestjs';
import secretsConfig from '../../config/secrets.config';

const secretsConfigModule = ConfigModule.forFeature(secretsConfig);

@Module({
  imports: [secretsConfigModule],
  providers: [
    {
      provide: HEMIA_SECRETS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SecretsClient => {
        const scope = config.getOrThrow<SecretsScope>('secrets.scope');

        if (!config.get<boolean>('secrets.enabled', false)) {
          return new DefaultSecretsClient(
            new InMemorySecretsAdapter(),
            new PathResolver(scope),
          );
        }

        return createSecretsClient({
          scope,
          provider: {
            type: 'hashicorp-vault',
            options: {
              baseUrl: config.getOrThrow<string>('secrets.vault.baseUrl'),
              roleId: config.getOrThrow<string>('secrets.vault.roleId'),
              secretId: config.getOrThrow<string>('secrets.vault.secretId'),
              authPath: config.getOrThrow<string>('secrets.vault.authPath'),
              mountPrefix: config.getOrThrow<string>(
                'secrets.vault.mountPrefix',
              ),
              timeoutMs: config.getOrThrow<number>('secrets.vault.timeoutMs'),
            },
          },
          cache: config.getOrThrow('secrets.cache'),
        });
      },
    },
    { provide: SecretsService, useExisting: HEMIA_SECRETS },
  ],
  exports: [HEMIA_SECRETS, SecretsService],
})
export class SecretsModule {}
