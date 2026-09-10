import { VaultCustodyAdapter } from '../src/modules/efirma/vault-custody.adapter';
import {
  custodyAad,
  type CustodyContext,
} from '../src/modules/efirma/custody-envelope';
import { randomBytes } from 'node:crypto';

describe('one-time Vault protocol', () => {
  const config = {
    address: 'http://127.0.0.1:8200',
    transitMount: 'efirma',
    transitKey: 'wrapping',
    identity: { roleId: 'synthetic-role', secretId: 'synthetic-secret' },
  };
  const context: CustodyContext = {
    organizationId: 'org',
    legalEntityId: 'entity',
    intentionId: 'intent',
    purpose: 'efirma.prepare',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    generation: 'generation',
  };
  afterEach(() => jest.restoreAllMocks());
  it('does not retry an ambiguous unwrap or leak Vault errors', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth: { client_token: 'synthetic-login', lease_duration: 300 },
          }),
        ),
      )
      .mockRejectedValueOnce(new Error('sensitive upstream diagnostic'));
    await expect(
      new VaultCustodyAdapter(config).unwrap('synthetic-bearer', context),
    ).rejects.toThrow('EFIRMA_VAULT_UNAVAILABLE_OR_UNCERTAIN');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((fetch.mock.calls[1][0] as URL).pathname).toContain(
      '/sys/wrapping/unwrap',
    );
  });
  it('validates the unwrapped DEK context', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth: { client_token: 'synthetic-login', lease_duration: 300 },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              dek: randomBytes(32).toString('base64'),
              context: custodyAad({
                ...context,
                legalEntityId: 'foreign',
              }).toString('base64'),
            },
          }),
        ),
      );
    await expect(
      new VaultCustodyAdapter(config).unwrap('synthetic-bearer', context),
    ).rejects.toThrow('EFIRMA_VAULT_UNAVAILABLE_OR_UNCERTAIN');
  });
  it('sends only remaining TTL and never restarts a ten-minute window', async () => {
    const remaining = {
      ...context,
      expiresAt: new Date(Date.now() + 30000).toISOString(),
    };
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth: { client_token: 'synthetic-login', lease_duration: 300 },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            wrap_info: {
              token: 'bearer',
              accessor: 'accessor',
              creation_time: new Date().toISOString(),
              ttl: 20,
            },
          }),
        ),
      );
    await new VaultCustodyAdapter(config).wrap(randomBytes(32), remaining);
    const header = (fetch.mock.calls[1][1]!.headers as Record<string, string>)[
      'X-Vault-Wrap-TTL'
    ];
    expect(parseInt(header)).toBeLessThanOrEqual(25);
    expect(parseInt(header)).toBeGreaterThan(0);
  });
  it('rejects a wrapping response exceeding the absolute deadline', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth: { client_token: 'synthetic-login', lease_duration: 300 },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            wrap_info: {
              token: 'bearer',
              accessor: 'accessor',
              creation_time: new Date().toISOString(),
              ttl: 3600,
            },
          }),
        ),
      );
    await expect(
      new VaultCustodyAdapter(config).wrap(randomBytes(32), context),
    ).rejects.toThrow('EFIRMA_VAULT_UNAVAILABLE_OR_UNCERTAIN');
  });
});
