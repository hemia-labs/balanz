import { custodyAad, type CustodyContext } from './custody-envelope';

export interface VaultCustodyIdentity {
  roleId: string;
  secretId: string;
}
export interface VaultCustodyConfiguration {
  address: string;
  transitMount: string;
  transitKey: string;
  identity: VaultCustodyIdentity;
}
interface VaultReply {
  auth?: { client_token?: string; lease_duration?: number };
  data?: {
    ciphertext?: string;
    plaintext?: string;
    dek?: string;
    context?: string;
  };
  wrap_info?: {
    token?: string;
    accessor?: string;
    creation_time?: string;
    ttl?: number;
  };
}

/** Separate AppRole identity per capability. Only the login token is cached. */
export class VaultCustodyAdapter {
  private login?: { token: string; expires: number };
  constructor(private readonly configuration: VaultCustodyConfiguration) {
    for (const segment of [
      configuration.transitMount,
      configuration.transitKey,
    ])
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(segment))
        throw new Error('EFIRMA_VAULT_CONFIGURATION');
  }

  private async request(
    path: string,
    body: object,
    token?: string,
    ttl?: number,
  ): Promise<VaultReply> {
    try {
      const response = await fetch(
        new URL(`/v1/${path}`, this.configuration.address),
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'X-Vault-Token': token } : {}),
            ...(ttl ? { 'X-Vault-Wrap-TTL': `${ttl}s` } : {}),
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error();
      }
      if (response.status === 204) return {};
      if (!response.body) throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.length;
          if (bytes > 16384) throw new Error();
          chunks.push(part.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as VaultReply;
      } finally {
        await reader.cancel();
        for (const chunk of chunks) chunk.fill(0);
      }
    } catch {
      // Never expose Vault errors, request bodies, tokens, or native causes.
      throw new Error('EFIRMA_VAULT_UNAVAILABLE_OR_UNCERTAIN');
    }
  }

  private async authenticate(): Promise<string> {
    if (this.login && this.login.expires > Date.now()) return this.login.token;
    const reply = await this.request('auth/approle/login', {
      role_id: this.configuration.identity.roleId,
      secret_id: this.configuration.identity.secretId,
    });
    if (!reply.auth?.client_token || !reply.auth.lease_duration)
      throw new Error('EFIRMA_VAULT_UNAVAILABLE_OR_UNCERTAIN');
    this.login = {
      token: reply.auth.client_token,
      expires: Date.now() + Math.max(0, reply.auth.lease_duration - 10) * 1000,
    };
    return this.login.token;
  }

  async wrap(
    dek: Buffer,
    context: CustodyContext,
  ): Promise<{ token: string; accessor: string; expiresAt: Date }> {
    const auth = await this.authenticate();
    // Reserve the request timeout; a delayed/ambiguous response never renews the intention.
    const ttl = Math.floor(
      (Date.parse(context.expiresAt) - Date.now() - 5000) / 1000,
    );
    if (ttl < 1 || ttl > 600 || dek.length !== 32)
      throw new Error('EFIRMA_EXPIRED');
    const reply = await this.request(
      'sys/wrapping/wrap',
      {
        dek: dek.toString('base64'),
        context: custodyAad(context).toString('base64'),
      },
      auth,
      ttl,
    );
    const wrapped = reply.wrap_info;
    if (
      !wrapped?.token ||
      !wrapped.accessor ||
      !wrapped.creation_time ||
      !wrapped.ttl
    )
      throw new Error('EFIRMA_VAULT_UNAVAILABLE_OR_UNCERTAIN');
    const expiresAt = new Date(
      Date.parse(wrapped.creation_time) + wrapped.ttl * 1000,
    );
    if (
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() > Date.parse(context.expiresAt)
    )
      throw new Error('EFIRMA_VAULT_UNAVAILABLE_OR_UNCERTAIN');
    return { token: wrapped.token, accessor: wrapped.accessor, expiresAt };
  }

  async encryptToken(token: string, context: CustodyContext): Promise<string> {
    const auth = await this.authenticate();
    const reply = await this.request(
      `${this.configuration.transitMount}/encrypt/${this.configuration.transitKey}`,
      {
        plaintext: Buffer.from(token).toString('base64'),
        context: custodyAad(context).toString('base64'),
      },
      auth,
    );
    if (!reply.data?.ciphertext?.match(/^vault:v[0-9]+:/))
      throw new Error('EFIRMA_VAULT_UNAVAILABLE_OR_UNCERTAIN');
    return reply.data.ciphertext;
  }

  async decryptToken(
    ciphertext: string,
    context: CustodyContext,
  ): Promise<string> {
    const reply = await this.request(
      `${this.configuration.transitMount}/decrypt/${this.configuration.transitKey}`,
      {
        ciphertext,
        context: custodyAad(context).toString('base64'),
      },
      await this.authenticate(),
    );
    if (!reply.data?.plaintext)
      throw new Error('EFIRMA_VAULT_UNAVAILABLE_OR_UNCERTAIN');
    const plaintext = Buffer.from(reply.data.plaintext, 'base64');
    try {
      return plaintext.toString('utf8');
    } finally {
      plaintext.fill(0);
    }
  }

  /** Exactly one request, with no retry even when the outcome is ambiguous. */
  async unwrap(token: string, context: CustodyContext): Promise<Buffer> {
    const reply = await this.request(
      'sys/wrapping/unwrap',
      { token },
      await this.authenticate(),
    );
    const dek = Buffer.from(reply.data?.dek ?? '', 'base64');
    if (
      dek.length !== 32 ||
      reply.data?.context !== custodyAad(context).toString('base64')
    ) {
      dek.fill(0);
      throw new Error('EFIRMA_VAULT_UNAVAILABLE_OR_UNCERTAIN');
    }
    return dek;
  }

  async revoke(accessor: string): Promise<void> {
    await this.request(
      'auth/token/revoke-accessor',
      { accessor },
      await this.authenticate(),
    );
  }
}
