import { MigrationInterface, QueryRunner } from 'typeorm';

export class PhaseThreeEfirmaCustody1787691000000 implements MigrationInterface {
  name = 'PhaseThreeEfirmaCustody1787691000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'GRANT INSERT(retention_until) ON stored_objects TO balanz_api',
    );
    await runner.query(`CREATE UNIQUE INDEX uq_auth_sessions_fiscal_identity
      ON auth_sessions(id,user_id,organization_id,membership_id)`);
    for (const table of ['fiscal_reauth_grants', 'efirma_sessions']) {
      await runner.query(`CREATE TABLE ${table} (
        id uuid PRIMARY KEY, organization_id uuid NOT NULL, client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL, user_id uuid NOT NULL, membership_id uuid NOT NULL,
        auth_session_id uuid, purpose varchar(32) NOT NULL DEFAULT 'efirma.prepare' CHECK(purpose='efirma.prepare'),
        generation uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        expires_at timestamptz NOT NULL,
        CHECK(expires_at>created_at AND expires_at<=created_at+interval '600 seconds'),
        UNIQUE(organization_id,client_account_id,legal_entity_id,id),
        FOREIGN KEY(organization_id,client_account_id,legal_entity_id)
          REFERENCES legal_entities(organization_id,client_account_id,id),
        FOREIGN KEY(organization_id,membership_id,user_id) REFERENCES memberships(organization_id,id,user_id),
        FOREIGN KEY(auth_session_id,user_id,organization_id,membership_id)
          REFERENCES auth_sessions(id,user_id,organization_id,membership_id) ON DELETE SET NULL(auth_session_id)
      )`);
      await runner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await runner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await runner.query(`CREATE POLICY ${table}_api ON ${table} TO balanz_api
        USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid
          AND membership_id=nullif(current_setting('app.membership_id',true),'')::uuid)
        WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid
          AND membership_id=nullif(current_setting('app.membership_id',true),'')::uuid)`);
      await runner.query(`CREATE POLICY ${table}_worker ON ${table} TO balanz_worker
        USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid
          AND current_setting('app.membership_id',true)='00000000-0000-0000-0000-000000000000')
        WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid
          AND current_setting('app.membership_id',true)='00000000-0000-0000-0000-000000000000')`);
      await runner.query(`GRANT SELECT,INSERT,UPDATE ON ${table} TO balanz_api;
        GRANT SELECT,UPDATE ON ${table} TO balanz_worker;
        GRANT SELECT,UPDATE,DELETE ON ${table} TO balanz_fiscal_reconcile_owner`);
      await runner.query(
        `CREATE INDEX ix_${table}_expiry ON ${table}(expires_at,id)`,
      );
      await runner.query(
        `CREATE INDEX ix_${table}_scope ON ${table}(organization_id,membership_id,legal_entity_id,created_at,id)`,
      );
    }
    await runner.query(`ALTER TABLE fiscal_reauth_grants
      ADD token_hash char(64) NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
      ADD consumed_at timestamptz, ADD revoked_at timestamptz`);
    await runner.query(`ALTER TABLE efirma_sessions
      ADD grant_id uuid NOT NULL UNIQUE,
      ADD replaces_id uuid,
      ADD idempotency_key varchar(128) NOT NULL,
      ADD request_fingerprint char(64) NOT NULL CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'),
      ADD status varchar(40) NOT NULL DEFAULT 'preparing' CHECK(status IN
        ('preparing','ready','claimed','unwrapping','consumed','revoked','expired','failed','requires_user_authorization')),
      ADD certificate_object_id uuid, ADD private_key_object_id uuid,
      ADD certificate_sha256 char(64), ADD certificate_not_after timestamptz,
      ADD certificate_profile varchar(32) CHECK(certificate_profile='synthetic_v1'),
      ADD local_validation_passed boolean NOT NULL DEFAULT false,
      ADD envelope_version smallint NOT NULL DEFAULT 1 CHECK(envelope_version=1),
      ADD wrapped_token_ciphertext text CHECK(wrapped_token_ciphertext ~ '^vault:v[0-9]+:'),
      ADD wrapping_accessor varchar(512), ADD wrapping_expires_at timestamptz,
      ADD claim_id uuid, ADD lease_until timestamptz,
      ADD terminal_at timestamptz, ADD error_code varchar(64),
      ADD cleanup_requested_at timestamptz, ADD cleanup_completed_at timestamptz,
      ADD cleanup_claim_id uuid, ADD cleanup_lease_until timestamptz,
      ADD reconciled_at timestamptz,
      ADD CONSTRAINT ck_efirma_wrapping_expiry CHECK(wrapping_expires_at<=expires_at),
      ADD CONSTRAINT ck_efirma_ready_material CHECK(status NOT IN('ready','claimed','unwrapping') OR
        (auth_session_id IS NOT NULL AND certificate_object_id IS NOT NULL AND private_key_object_id IS NOT NULL
          AND local_validation_passed AND certificate_profile IS NOT NULL AND wrapped_token_ciphertext IS NOT NULL
          AND wrapping_accessor IS NOT NULL AND wrapping_expires_at IS NOT NULL)),
      ADD CONSTRAINT ck_efirma_cleaned CHECK(cleanup_completed_at IS NULL OR
        (wrapped_token_ciphertext IS NULL AND wrapping_accessor IS NULL AND certificate_object_id IS NULL AND private_key_object_id IS NULL)),
      ADD CONSTRAINT uq_efirma_idempotency UNIQUE(organization_id,membership_id,legal_entity_id,idempotency_key),
      ADD CONSTRAINT fk_efirma_grant FOREIGN KEY(organization_id,client_account_id,legal_entity_id,grant_id)
        REFERENCES fiscal_reauth_grants(organization_id,client_account_id,legal_entity_id,id),
      ADD CONSTRAINT fk_efirma_replaces FOREIGN KEY(organization_id,client_account_id,legal_entity_id,replaces_id)
        REFERENCES efirma_sessions(organization_id,client_account_id,legal_entity_id,id) ON DELETE SET NULL(replaces_id),
      ADD CONSTRAINT fk_efirma_certificate FOREIGN KEY(organization_id,client_account_id,legal_entity_id,certificate_object_id)
        REFERENCES stored_objects(organization_id,client_account_id,legal_entity_id,id),
      ADD CONSTRAINT fk_efirma_private_key FOREIGN KEY(organization_id,client_account_id,legal_entity_id,private_key_object_id)
        REFERENCES stored_objects(organization_id,client_account_id,legal_entity_id,id)`);
    await runner.query(`CREATE INDEX ix_efirma_cleanup ON efirma_sessions(cleanup_requested_at,id)
      WHERE cleanup_completed_at IS NULL;
      CREATE INDEX ix_efirma_terminal ON efirma_sessions(terminal_at,id) WHERE cleanup_completed_at IS NOT NULL`);
    // The narrow definer can inspect authorization, but runtime workers cannot read MFA secrets.
    await runner.query(`GRANT SELECT(id,status,email_verified_at) ON users TO balanz_fiscal_reconcile_owner;
      GRANT SELECT(id,user_id,organization_id,membership_id,status,expires_at,last_activity_at,mfa_verified_at) ON auth_sessions TO balanz_fiscal_reconcile_owner;
      GRANT SELECT(user_id,status) ON auth_factors TO balanz_fiscal_reconcile_owner;
      GRANT SELECT ON organizations,memberships,client_accounts,legal_entities,account_assignments,permissions,role_permissions,membership_permissions TO balanz_fiscal_reconcile_owner`);
    await runner.query(`CREATE FUNCTION efirma_authorized(u uuid,s uuid,o uuid,m uuid,a uuid,e uuid,idle_seconds integer)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
      SELECT o=nullif(current_setting('app.organization_id',true),'')::uuid
        AND current_setting('app.membership_id',true) IN(m::text,'00000000-0000-0000-0000-000000000000')
        AND EXISTS(SELECT 1 FROM public.auth_sessions session
          JOIN public.users usr ON usr.id=session.user_id AND usr.status='active' AND usr.email_verified_at IS NOT NULL
          JOIN public.organizations org ON org.id=o AND org.status='active'
          JOIN public.memberships member ON member.id=m AND member.organization_id=o AND member.user_id=u AND member.status='active'
          JOIN public.client_accounts account ON account.id=a AND account.organization_id=o AND account.status='active'
          JOIN public.legal_entities entity ON entity.id=e AND entity.organization_id=o AND entity.client_account_id=a AND entity.status='active'
          JOIN public.permissions permission ON permission.key='credentials.manage' AND permission.status='active'
          WHERE session.id=s AND session.user_id=u AND session.organization_id=o AND session.membership_id=m
            AND session.status='active' AND session.expires_at>statement_timestamp() AND session.mfa_verified_at IS NOT NULL
            AND session.last_activity_at+make_interval(secs=>least(greatest(idle_seconds,1),86400))>statement_timestamp()
            AND EXISTS(SELECT 1 FROM public.auth_factors factor WHERE factor.user_id=u AND factor.status='active')
            AND (org.owner_user_id=u OR EXISTS(SELECT 1 FROM public.account_assignments assignment
              WHERE assignment.organization_id=o AND assignment.membership_id=m AND assignment.client_account_id=a AND assignment.status='active'))
            AND NOT EXISTS(SELECT 1 FROM public.membership_permissions override WHERE override.organization_id=o AND override.membership_id=m
              AND override.permission_id=permission.id AND override.revoked_at IS NULL AND override.effect='deny')
            AND (EXISTS(SELECT 1 FROM public.membership_permissions override WHERE override.organization_id=o AND override.membership_id=m
              AND override.permission_id=permission.id AND override.revoked_at IS NULL AND override.effect='grant')
              OR EXISTS(SELECT 1 FROM public.role_permissions rp WHERE rp.role_id=member.role_id AND rp.permission_id=permission.id
                AND rp.enabled AND (rp.valid_from IS NULL OR rp.valid_from<=statement_timestamp()) AND (rp.valid_until IS NULL OR rp.valid_until>statement_timestamp())))) $$`);
    await runner.query(`CREATE FUNCTION invalidate_efirma_session_authority() RETURNS trigger LANGUAGE plpgsql
      SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
        UPDATE public.fiscal_reauth_grants SET revoked_at=coalesce(revoked_at,clock_timestamp()),auth_session_id=NULL WHERE auth_session_id=OLD.id;
        UPDATE public.efirma_sessions SET status='revoked',terminal_at=clock_timestamp(),cleanup_requested_at=clock_timestamp()
          WHERE auth_session_id=OLD.id AND status IN('preparing','ready','claimed','unwrapping');
        UPDATE public.efirma_sessions SET auth_session_id=NULL WHERE auth_session_id=OLD.id;
        RETURN NEW;
      END $$;
      CREATE TRIGGER efirma_session_authority_changed BEFORE UPDATE OF status,organization_id,membership_id,session_token_hash ON auth_sessions
      FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
        OR OLD.membership_id IS DISTINCT FROM NEW.membership_id OR OLD.session_token_hash IS DISTINCT FROM NEW.session_token_hash)
      EXECUTE FUNCTION invalidate_efirma_session_authority()`);
    await runner.query(`CREATE FUNCTION efirma_reconciliation_batch() RETURNS TABLE(id uuid,organization_id uuid)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
        DELETE FROM public.fiscal_reauth_grants g WHERE g.id IN (SELECT candidate.id FROM public.fiscal_reauth_grants candidate
          WHERE candidate.expires_at<clock_timestamp()-interval '90 days'
            AND NOT EXISTS(SELECT 1 FROM public.efirma_sessions e WHERE e.grant_id=candidate.id)
          ORDER BY candidate.expires_at LIMIT 100);
        RETURN QUERY WITH candidates AS (SELECT e.id FROM public.efirma_sessions e
          WHERE (e.cleanup_completed_at IS NULL OR e.terminal_at<clock_timestamp()-interval '90 days')
            AND (e.reconciled_at IS NULL OR e.reconciled_at<clock_timestamp()-interval '30 seconds')
          ORDER BY e.reconciled_at NULLS FIRST,e.id LIMIT 100 FOR UPDATE SKIP LOCKED)
        UPDATE public.efirma_sessions e SET reconciled_at=clock_timestamp() FROM candidates c WHERE e.id=c.id
        RETURNING e.id,e.organization_id;
      END $$`);
    await runner.query(`CREATE FUNCTION purge_efirma_metadata(target uuid) RETURNS void LANGUAGE plpgsql
      SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE deleted_grant uuid; BEGIN
        DELETE FROM public.efirma_sessions WHERE id=target
          AND organization_id=nullif(current_setting('app.organization_id',true),'')::uuid
          AND current_setting('app.membership_id',true)='00000000-0000-0000-0000-000000000000'
          AND cleanup_completed_at IS NOT NULL AND terminal_at<clock_timestamp()-interval '90 days'
          RETURNING grant_id INTO deleted_grant;
        IF deleted_grant IS NOT NULL THEN DELETE FROM public.fiscal_reauth_grants WHERE id=deleted_grant; END IF;
        DELETE FROM public.fiscal_reauth_grants g WHERE g.organization_id=nullif(current_setting('app.organization_id',true),'')::uuid
          AND g.expires_at<clock_timestamp()-interval '90 days' AND NOT EXISTS(SELECT 1 FROM public.efirma_sessions e WHERE e.grant_id=g.id);
      END $$`);
    await runner.query(`CREATE INDEX ix_credential_objects_reconcile ON stored_objects(updated_at,retention_until,id)
      WHERE kind IN('credential_certificate','credential_private_key');
      CREATE FUNCTION efirma_orphan_objects_batch() RETURNS TABLE(id uuid,organization_id uuid)
      LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
        WITH candidates AS(SELECT object.id FROM public.stored_objects object
          WHERE object.kind IN('credential_certificate','credential_private_key') AND object.retention_until<clock_timestamp()-interval '35 seconds'
            AND object.updated_at<clock_timestamp()-interval '5 minutes'
          ORDER BY object.updated_at,object.id LIMIT 100 FOR UPDATE SKIP LOCKED)
        UPDATE public.stored_objects object SET updated_at=clock_timestamp() FROM candidates candidate WHERE object.id=candidate.id
          RETURNING object.id,object.organization_id
      $$`);
    await runner.query(`DO $$ BEGIN EXECUTE format('GRANT balanz_fiscal_owner,balanz_fiscal_reconcile_owner TO %I',current_user); END $$;
      GRANT CREATE ON SCHEMA public TO balanz_fiscal_owner,balanz_fiscal_reconcile_owner;
      ALTER TABLE fiscal_reauth_grants OWNER TO balanz_fiscal_owner;
      ALTER TABLE efirma_sessions OWNER TO balanz_fiscal_owner;
      ALTER FUNCTION efirma_authorized(uuid,uuid,uuid,uuid,uuid,uuid,integer) OWNER TO balanz_fiscal_reconcile_owner;
      ALTER FUNCTION invalidate_efirma_session_authority() OWNER TO balanz_fiscal_reconcile_owner;
      ALTER FUNCTION efirma_reconciliation_batch() OWNER TO balanz_fiscal_reconcile_owner;
      ALTER FUNCTION purge_efirma_metadata(uuid) OWNER TO balanz_fiscal_reconcile_owner;
      ALTER FUNCTION efirma_orphan_objects_batch() OWNER TO balanz_fiscal_reconcile_owner;
      REVOKE ALL ON FUNCTION efirma_orphan_objects_batch() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION efirma_orphan_objects_batch() TO balanz_worker;
      REVOKE ALL ON FUNCTION purge_efirma_metadata(uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION purge_efirma_metadata(uuid) TO balanz_worker;
      REVOKE ALL ON FUNCTION efirma_reconciliation_batch() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION efirma_reconciliation_batch() TO balanz_worker;
      REVOKE ALL ON FUNCTION efirma_authorized(uuid,uuid,uuid,uuid,uuid,uuid,integer),invalidate_efirma_session_authority() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION efirma_authorized(uuid,uuid,uuid,uuid,uuid,uuid,integer) TO balanz_api,balanz_worker;
      REVOKE CREATE ON SCHEMA public FROM balanz_fiscal_owner,balanz_fiscal_reconcile_owner;
      DO $$ BEGIN EXECUTE format('REVOKE balanz_fiscal_owner,balanz_fiscal_reconcile_owner FROM %I',current_user); END $$`);
  }

  down(): Promise<void> {
    throw new Error(
      'Custody history is append-only; use a reviewed forward migration.',
    );
  }
}
