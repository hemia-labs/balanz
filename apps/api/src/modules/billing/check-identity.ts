import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { getBillingIdentityConfig } from '../../config/billing-identity.config';
import { runtimeEnvFilePaths } from '../../config/platform-config.module';
import { BillingIdentityService } from './billing-identity.service';

async function main() {
  config({ path: runtimeEnvFilePaths('api'), quiet: true });
  const settings = getBillingIdentityConfig();
  if (!settings.tokenUrl)
    throw new Error('Configure BILLING_IDENTITY_TOKEN_URL.');
  const discovery = new URL(
    '/.well-known/openid-configuration',
    settings.tokenUrl,
  );
  const response = await fetch(discovery, {
    redirect: 'error',
    signal: AbortSignal.timeout(settings.timeoutMs),
  });
  if (!response.ok) throw new Error('Identity discovery no está disponible.');
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== 'object' ||
    !('token_endpoint' in body) ||
    body.token_endpoint !== settings.tokenUrl ||
    !('grant_types_supported' in body) ||
    !Array.isArray(body.grant_types_supported) ||
    !body.grant_types_supported.includes('client_credentials')
  ) {
    throw new Error(
      'Identity no anuncia el endpoint configurado con client_credentials.',
    );
  }
  console.log('Conexión con Identity correcta; client_credentials disponible.');
  if (!settings.clientSecret) {
    console.log(
      'Pendiente: completar BILLING_CLIENT_SECRET en .env.api.local.',
    );
    return;
  }
  const service = new BillingIdentityService(
    new ConfigService({ billingIdentity: settings }),
  );
  await service.getAccessToken();
  console.log(
    'Autenticación del cliente de Billing correcta. Token y secreto no se muestran.',
  );
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Falló la comprobación de Identity.',
  );
  process.exitCode = 1;
});
