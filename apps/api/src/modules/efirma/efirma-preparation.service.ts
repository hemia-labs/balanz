import { Inject, Injectable, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FiscalPlatformConfig } from '../../config/fiscal-platform.config';
import type { ObjectStoragePort } from '../object-storage/ports/object-storage.port';
import { OBJECT_STORAGE_PORT } from '../object-storage/object-storage.tokens';
import { OpaqueObjectKeyFactory } from '../object-storage/services/opaque-object-key.factory';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { CertificateValidator } from './certificate-validator';
import { encryptPrivateKey } from './custody-envelope';
import { efirmaError } from './efirma.errors';
import {
  custodyDto,
  digest,
  EfirmaRepository,
  envelopeContext,
  type CustodyRow,
} from './efirma.repository';
import type { ReceivedCredentials } from './receive-credentials';
import { VaultCustodyAdapter } from './vault-custody.adapter';
import { EFIRMA_VAULT_RUNTIME } from './vault-custody.tokens';

@Injectable()
export class EfirmaPreparationService {
  private readonly fiscal: FiscalPlatformConfig;
  constructor(
    private readonly repository: EfirmaRepository,
    configuration: ConfigService,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
    @Inject(EFIRMA_VAULT_RUNTIME)
    private readonly vault: VaultCustodyAdapter | null,
  ) {
    this.fiscal =
      configuration.getOrThrow<FiscalPlatformConfig>('fiscalPlatform');
  }

  async prepare(
    tenant: SessionAuthorizationContext,
    entityId: string,
    idempotencyKey: string,
    input: ReceivedCredentials,
    correlationId: string,
  ) {
    let row: CustodyRow | undefined;
    let dek: Buffer | undefined;
    let plaintext: Buffer | undefined;
    let envelope: Buffer | undefined;
    try {
      const fingerprint = digest(
        JSON.stringify([
          'efirma_prepare_v1',
          tenant.organizationId,
          tenant.membershipId,
          tenant.userId,
          tenant.sessionId,
          entityId,
          digest(input.certificate),
          digest(input.encryptedKey),
          input.replacesId ?? null,
        ]),
      );
      const reservation = await this.repository.reserve(
        tenant,
        entityId,
        idempotencyKey,
        fingerprint,
        input.grant,
        input.replacesId,
        correlationId,
      );
      if (!reservation.created) return custodyDto(reservation.row);
      row = reservation.row;
      const validated = await new CertificateValidator(
        this.repository.config.syntheticTrustFile,
      ).validate(
        input.certificate,
        input.encryptedKey,
        input.password,
        reservation.rfc,
      );
      input.password.fill(0);
      plaintext = validated.key.export({ format: 'der', type: 'pkcs8' });
      dek = randomBytes(32);
      const context = envelopeContext(row);
      envelope = encryptPrivateKey(plaintext, dek, context);
      plaintext.fill(0);
      const vault = this.vault;
      if (!vault) throw efirmaError('EFIRMA_DEPENDENCY_UNAVAILABLE', 503);
      const certificateId = randomUUID();
      const keyId = randomUUID();
      const keys = new OpaqueObjectKeyFactory();
      const certificateKey = keys.create();
      const privateKey = keys.create();
      await this.repository.run(tenant, async (manager) => {
        await this.repository.authorized(manager, row!);
        const current: { id: string }[] = await manager.query(
          `WITH changed AS (UPDATE efirma_sessions SET certificate_object_id=NULL
          WHERE id=$1 AND status='preparing' AND claim_id=$2 AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() RETURNING id) SELECT * FROM changed`,
          [row!.id, row!.claim_id],
        );
        if (!current[0]) throw efirmaError('EFIRMA_AUTHORIZATION_LOST');
        for (const [id, kind, key] of [
          [certificateId, 'credential_certificate', certificateKey],
          [keyId, 'credential_private_key', privateKey],
        ]) {
          await manager.query(
            `INSERT INTO stored_objects(id,organization_id,client_account_id,legal_entity_id,kind,storage_provider,
            storage_container,object_key,encryption_class,retention_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'credential',$9)`,
            [
              id,
              row!.organization_id,
              row!.client_account_id,
              row!.legal_entity_id,
              kind,
              this.fiscal.storage.driver,
              this.fiscal.storage.driver === 's3'
                ? this.fiscal.storage.s3.bucket
                : 'local-private',
              key,
              row!.expires_at,
            ],
          );
        }
        await manager.query(
          'UPDATE efirma_sessions SET certificate_object_id=$2,private_key_object_id=$3 WHERE id=$1',
          [row!.id, certificateId, keyId],
        );
      });
      for (const [id, key, body] of [
        [certificateId, certificateKey, input.certificate],
        [keyId, privateKey, envelope],
      ] as const) {
        const written = await this.storage.putStream({
          objectKey: key,
          body: Readable.from([body]),
          expectedSizeBytes: body.length,
          contentType: 'application/octet-stream',
          signal: AbortSignal.timeout(5000),
        });
        await this.repository.run(tenant, async (manager) => {
          await manager.query(
            `UPDATE stored_objects SET lifecycle_state='uploaded',size_bytes=$2,sha256=$3,uploaded_at=clock_timestamp(),
            storage_etag=$4,storage_version_id=$5 WHERE id=$1 AND lifecycle_state='pending_upload'`,
            [
              id,
              written.sizeBytes,
              written.sha256,
              written.etag ?? null,
              written.versionId ?? null,
            ],
          );
        });
      }
      if ((await this.repository.generation()) !== row.generation)
        throw efirmaError('EFIRMA_AUTHORIZATION_LOST');
      await this.repository.run(tenant, async (manager) => {
        await this.repository.authorized(manager, row!);
        const current: { id: string }[] = await manager.query(
          `SELECT id FROM efirma_sessions WHERE id=$1 AND status='preparing'
          AND claim_id=$2 AND lease_until>clock_timestamp() AND expires_at>clock_timestamp()`,
          [row!.id, row!.claim_id],
        );
        if (!current[0]) throw efirmaError('EFIRMA_AUTHORIZATION_LOST');
      });
      const wrapped = await vault.wrap(dek, context);
      dek.fill(0);
      await this.repository.run(tenant, async (manager) => {
        // Save the cleanup reference even if revocation won while wrapping was in flight.
        await manager.query(
          'UPDATE efirma_sessions SET wrapping_accessor=$2,wrapping_expires_at=$3 WHERE id=$1 AND cleanup_completed_at IS NULL',
          [row!.id, wrapped.accessor, wrapped.expiresAt],
        );
      });
      const encryptedToken = await vault.encryptToken(wrapped.token, context);
      wrapped.token = '';
      return await this.repository.run(tenant, async (manager) => {
        await this.repository.authorized(manager, row!);
        if ((await this.repository.generation()) !== row!.generation)
          throw efirmaError('EFIRMA_AUTHORIZATION_LOST');
        const ready: CustodyRow[] = await manager.query(
          `WITH changed AS (UPDATE efirma_sessions SET status='ready',wrapped_token_ciphertext=$3,
          certificate_sha256=$4,certificate_not_after=$5,certificate_profile='synthetic_v1',local_validation_passed=true,claim_id=NULL,lease_until=NULL
          WHERE id=$1 AND claim_id=$2 AND status='preparing' AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() RETURNING *) SELECT * FROM changed`,
          [
            row!.id,
            row!.claim_id,
            encryptedToken,
            digest(input.certificate),
            new Date(validated.certificate.validTo),
          ],
        );
        if (!ready[0]) throw efirmaError('EFIRMA_AUTHORIZATION_LOST');
        await this.repository.audit(
          manager,
          ready[0],
          'efirma.custody.ready',
          correlationId,
        );
        return custodyDto(ready[0]);
      });
    } catch (error) {
      if (row) {
        await this.repository
          .run(tenant, async (manager) => {
            const code =
              error instanceof HttpException
                ? (error.getResponse() as { code?: string }).code
                : undefined;
            const safeCode = code?.startsWith('EFIRMA_')
              ? code
              : 'EFIRMA_PREPARATION_UNCERTAIN';
            const failed: CustodyRow[] = await manager.query(
              `WITH changed AS (UPDATE efirma_sessions SET status='requires_user_authorization',
            terminal_at=clock_timestamp(),cleanup_requested_at=clock_timestamp(),error_code=$2
            WHERE id=$1 AND status='preparing' RETURNING *) SELECT * FROM changed`,
              [row!.id, safeCode],
            );
            if (failed[0])
              await this.repository.audit(
                manager,
                failed[0],
                'efirma.custody.preparation_failed',
                correlationId,
              );
          })
          .catch(() => undefined);
      }
      const controlled =
        error instanceof HttpException
          ? error
          : efirmaError('EFIRMA_DEPENDENCY_UNAVAILABLE', 503);
      if (row)
        throw new HttpException(
          {
            ...(controlled.getResponse() as object),
            details: {
              efirmaSessionId: row.id,
              legalEntityId: row.legal_entity_id,
            },
          },
          controlled.getStatus(),
        );
      throw controlled;
    } finally {
      dek?.fill(0);
      plaintext?.fill(0);
      envelope?.fill(0);
      input.dispose();
    }
  }
}
