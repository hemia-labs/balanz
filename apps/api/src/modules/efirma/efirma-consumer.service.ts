import { Inject, Injectable } from '@nestjs/common';
import {
  createPrivateKey,
  randomUUID,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { ObjectStoragePort } from '../object-storage/ports/object-storage.port';
import { OBJECT_STORAGE_PORT } from '../object-storage/object-storage.tokens';
import { decryptPrivateKey } from './custody-envelope';
import {
  digest,
  EfirmaRepository,
  envelopeContext,
  type CustodyRow,
} from './efirma.repository';
import { efirmaError } from './efirma.errors';
import { VaultCustodyAdapter } from './vault-custody.adapter';

/** Internal worker-only port. The callback must not retain or return the credential. */
@Injectable()
export class EfirmaConsumerService {
  constructor(
    private readonly repository: EfirmaRepository,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
  ) {}

  async withCredential(
    organizationId: string,
    intentionId: string,
    operation: (
      key: KeyObject,
      certificate: X509Certificate,
      checkAuthority: () => Promise<void>,
    ) => Promise<void>,
  ): Promise<void> {
    const generation = await this.repository.generation();
    const claim = randomUUID();
    const run = <T>(work: (manager: EntityManager) => Promise<T>) =>
      this.repository.transactions.runAsWorker({ organizationId }, work);
    const row = await run(async (manager) => {
      const rows: CustodyRow[] = await manager.query(
        `SELECT * FROM efirma_sessions WHERE id=$1 FOR UPDATE`,
        [intentionId],
      );
      const current = rows[0];
      if (
        !current ||
        current.generation !== generation ||
        current.expires_at.getTime() <= Date.now() ||
        !(
          current.status === 'ready' ||
          (current.status === 'claimed' &&
            current.lease_until &&
            current.lease_until.getTime() < Date.now())
        )
      )
        throw efirmaError('EFIRMA_NOT_CONSUMABLE');
      await this.repository.authorized(manager, current);
      await manager.query(
        `UPDATE efirma_sessions SET status='claimed',claim_id=$2,lease_until=least(expires_at,clock_timestamp()+interval '30 seconds') WHERE id=$1`,
        [intentionId, claim],
      );
      return current;
    });
    let dek: Buffer | undefined;
    let plaintext: Buffer | undefined;
    let token = '';
    let unwrapStarted = false;
    const checkAuthority = async () => {
      if ((await this.repository.generation()) !== generation)
        throw efirmaError('EFIRMA_AUTHORIZATION_LOST');
      await run(async (manager) => {
        const rows: CustodyRow[] = await manager.query(
          `SELECT * FROM efirma_sessions WHERE id=$1 AND claim_id=$2
          AND status IN('claimed','unwrapping') AND expires_at>clock_timestamp() AND lease_until>clock_timestamp()`,
          [intentionId, claim],
        );
        if (!rows[0]) throw efirmaError('EFIRMA_AUTHORIZATION_LOST');
        await this.repository.authorized(manager, rows[0]);
      });
    };
    try {
      const read = async (id: string | null) => {
        const objects: {
          object_key: string;
          sha256: string;
          size_bytes: string;
        }[] = await run((manager) =>
          manager.query(
            `SELECT object_key,sha256,size_bytes FROM stored_objects
          WHERE id=$1 AND organization_id=$2 AND legal_entity_id=$3 AND kind IN('credential_certificate','credential_private_key') AND lifecycle_state='uploaded'`,
            [id, organizationId, row.legal_entity_id],
          ),
        );
        if (!objects[0]) throw efirmaError('EFIRMA_OBJECT_UNAVAILABLE');
        const object = objects[0];
        const stream = await this.storage.openReadStream(
          object.object_key,
          AbortSignal.timeout(5000),
        );
        const chunks: Buffer[] = [];
        let bytes = 0;
        try {
          for await (const chunk of stream) {
            const part = Buffer.from(chunk as Uint8Array);
            chunks.push(part);
            bytes += part.length;
            if (bytes > 32768) throw efirmaError('EFIRMA_OBJECT_UNAVAILABLE');
          }
          const body = Buffer.concat(chunks);
          if (
            bytes !== Number(object.size_bytes) ||
            digest(body) !== object.sha256
          ) {
            body.fill(0);
            throw efirmaError('EFIRMA_OBJECT_UNAVAILABLE');
          }
          return body;
        } finally {
          stream.destroy();
          for (const chunk of chunks) chunk.fill(0);
        }
      };
      const certificate = await read(row.certificate_object_id);
      const envelope = await read(row.private_key_object_id);
      await checkAuthority();
      const vault = new VaultCustodyAdapter(this.repository.config.vault!);
      token = await vault.decryptToken(
        row.wrapped_token_ciphertext!,
        envelopeContext(row),
      );
      await checkAuthority();
      await run(async (manager) => {
        const changed: { id: string }[] = await manager.query(
          `WITH changed AS (UPDATE efirma_sessions SET status='unwrapping' WHERE id=$1 AND claim_id=$2
          AND status='claimed' AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() RETURNING id) SELECT * FROM changed`,
          [intentionId, claim],
        );
        if (!changed[0]) throw efirmaError('EFIRMA_AUTHORIZATION_LOST');
      });
      unwrapStarted = true;
      dek = await vault.unwrap(token, envelopeContext(row));
      token = '';
      await checkAuthority();
      plaintext = decryptPrivateKey(envelope, dek, envelopeContext(row));
      const key = createPrivateKey({
        key: plaintext,
        format: 'der',
        type: 'pkcs8',
      });
      const cert = new X509Certificate(certificate);
      if (!cert.checkPrivateKey(key)) throw efirmaError('EFIRMA_KEY_MISMATCH');
      plaintext.fill(0);
      dek.fill(0);
      await checkAuthority();
      await operation(key, cert, checkAuthority);
      await checkAuthority();
      await run(async (manager) => {
        const changed: CustodyRow[] = await manager.query(
          `WITH changed AS (UPDATE efirma_sessions SET status='consumed',terminal_at=clock_timestamp(),
          cleanup_requested_at=clock_timestamp(),lease_until=NULL WHERE id=$1 AND claim_id=$2 AND status='unwrapping'
          AND expires_at>clock_timestamp() AND lease_until>clock_timestamp() RETURNING *) SELECT * FROM changed`,
          [intentionId, claim],
        );
        if (!changed[0]) throw efirmaError('EFIRMA_AUTHORIZATION_LOST');
        await this.repository.audit(
          manager,
          changed[0],
          'efirma.custody.consumed',
          randomUUID(),
        );
      });
    } catch {
      if (unwrapStarted)
        await run(async (manager) => {
          const changed: CustodyRow[] = await manager.query(
            `WITH changed AS (UPDATE efirma_sessions SET status='requires_user_authorization',
          terminal_at=clock_timestamp(),cleanup_requested_at=clock_timestamp(),lease_until=NULL,error_code='EFIRMA_CONSUMPTION_UNCERTAIN'
          WHERE id=$1 AND claim_id=$2 AND status IN('claimed','unwrapping') RETURNING *) SELECT * FROM changed`,
            [intentionId, claim],
          );
          if (changed[0])
            await this.repository.audit(
              manager,
              changed[0],
              'efirma.custody.consumption_uncertain',
              randomUUID(),
            );
        });
      throw efirmaError(
        unwrapStarted
          ? 'EFIRMA_REQUIRES_USER_AUTHORIZATION'
          : 'EFIRMA_NOT_CONSUMABLE',
      );
    } finally {
      token = '';
      dek?.fill(0);
      plaintext?.fill(0);
    }
  }
}
