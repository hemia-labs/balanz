import { VaultCustodyAdapter } from '../src/modules/efirma/vault-custody.adapter';
import { performance } from 'node:perf_hooks';

describe('Vault capability login lifetime', () => {
  const configuration = (roleId: string) => ({
    address: 'http://127.0.0.1:8200',
    transitMount: 'efirma',
    transitKey: 'wrapping',
    identity: { roleId, secretId: 'synthetic-only' },
  });
  afterEach(() => jest.restoreAllMocks());
  function server(lease = 300) {
    return jest.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      if ((url as URL).pathname === '/v1/auth/approle/login') {
        const body = JSON.parse(init!.body as string) as { role_id: string };
        return Promise.resolve(
          new Response(
            JSON.stringify({
              auth: { client_token: body.role_id, lease_duration: lease },
            }),
          ),
        );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
  }
  it('coalesces one hundred concurrent cleanup logins but never caches operations', async () => {
    const fetch = server();
    const adapter = new VaultCustodyAdapter(configuration('cleanup'));
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        adapter.revoke('synthetic-accessor-' + index),
      ),
    );
    expect(
      fetch.mock.calls.filter(([url]) =>
        (url as URL).pathname.endsWith('/login'),
      ),
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.filter(([url]) =>
        (url as URL).pathname.endsWith('/revoke-accessor'),
      ),
    ).toHaveLength(100);
  });
  it('does not share login tokens between runtime capabilities', async () => {
    const fetch = server();
    const preparer = new VaultCustodyAdapter(configuration('preparer'));
    const cleaner = new VaultCustodyAdapter(configuration('cleanup'));
    await Promise.all([
      preparer.revoke('synthetic-one'),
      cleaner.revoke('synthetic-two'),
    ]);
    const headers = fetch.mock.calls
      .filter(([url]) => !(url as URL).pathname.endsWith('/login'))
      .map(
        ([, init]) =>
          (init!.headers as Record<string, string>)['X-Vault-Token'],
      );
    expect(headers.sort()).toEqual(['cleanup', 'preparer']);
  });
  it('reauthenticates after the login lease and ignores wall clock jumps', async () => {
    const time = jest.spyOn(performance, 'now').mockReturnValue(1000);
    const fetch = server(30);
    const adapter = new VaultCustodyAdapter(configuration('cleanup'));
    await adapter.revoke('synthetic-one');
    jest.spyOn(Date, 'now').mockReturnValue(0);
    time.mockReturnValue(2000);
    await adapter.revoke('synthetic-two');
    expect(
      fetch.mock.calls.filter(([url]) =>
        (url as URL).pathname.endsWith('/login'),
      ),
    ).toHaveLength(1);
    time.mockReturnValue(22000);
    await adapter.revoke('synthetic-three');
    expect(
      fetch.mock.calls.filter(([url]) =>
        (url as URL).pathname.endsWith('/login'),
      ),
    ).toHaveLength(2);
  });
  it('clears a failed in-flight login without retrying the requested operation', async () => {
    const fetch = server();
    fetch.mockRejectedValueOnce(
      new Error('synthetic sensitive upstream error'),
    );
    const adapter = new VaultCustodyAdapter(configuration('cleanup'));
    await expect(adapter.revoke('synthetic-one')).rejects.toThrow(
      'EFIRMA_VAULT_UNAVAILABLE_OR_UNCERTAIN',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    await adapter.revoke('synthetic-two');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
