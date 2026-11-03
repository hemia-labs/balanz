import 'reflect-metadata';
import { config } from 'dotenv';
import { createPaymentsClient } from '@hemia/payments';
import { loadPaymentsSettings } from '../../config/payments.config';
import { runtimeEnvFilePaths } from '../../config/platform-config.module';

async function main() {
  config({ path: runtimeEnvFilePaths('api'), quiet: true });
  const settings = await loadPaymentsSettings();
  if (!settings.connection || !settings.clientSecret)
    throw new Error('Configure la conexión de Payments y HEMIA_CLIENT_SECRET.');
  const payments = createPaymentsClient({
    ...settings.connection,
    clientSecret: settings.clientSecret,
  });
  const compatibility = await payments.verifyCompatibility();
  await payments.catalog.listPlans();
  console.log(
    `Conexión Identity → Billing verificada; Billing ${compatibility.billingVersion} compatible (${compatibility.contract}).`,
  );
}
void main().catch(() => {
  console.error(
    'La conexión de pagos no está lista; revise la configuración y permisos.',
  );
  process.exitCode = 1;
});
