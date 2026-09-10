import { MigrationInterface, QueryRunner } from 'typeorm';
export class PhaseFourSatOnDemand1787691100000 implements MigrationInterface {
  name = 'PhaseFourSatOnDemand1787691100000';
  async up(r: QueryRunner): Promise<void> {
    await r.query(`GRANT UPDATE(storage_etag,storage_version_id) ON stored_objects TO balanz_worker;
    GRANT INSERT(id,organization_id,client_account_id,legal_entity_id,source_type,root_object_id,requested_by_membership_id,idempotency_key,request_fingerprint,status,correlation_id,idempotency_expires_at,next_attempt_at) ON ingestion_jobs TO balanz_worker;
    GRANT SELECT(idempotency_key,request_fingerprint) ON ingestion_jobs TO balanz_worker;`);
    await r.query(`CREATE TABLE sat_download_jobs(
   id uuid PRIMARY KEY,organization_id uuid NOT NULL,client_account_id uuid NOT NULL,legal_entity_id uuid NOT NULL,
   user_id uuid NOT NULL,membership_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
   idempotency_key varchar(128) NOT NULL,request_fingerprint char(64) NOT NULL CHECK(request_fingerprint~'^[0-9a-f]{64}$'),
   filter_version integer NOT NULL DEFAULT 1 CHECK(filter_version=1),direction varchar(12) NOT NULL CHECK(direction IN('issued','received','folio')),
   content_type varchar(8) NOT NULL CHECK(content_type IN('xml','metadata')),date_from timestamp,date_to timestamp,folio uuid,
   document_type char(1) NOT NULL CHECK(document_type IN('I','E','T','P')),document_status varchar(12) NOT NULL CHECK(document_status IN('active','cancelled','all')),
   status varchar(40) NOT NULL DEFAULT 'authorization_pending' CHECK(status IN('authorization_pending','submitting','waiting_sat','requires_user_authorization','recovering','processing_local','completed','completed_with_issues','cancelled','failed','external_submission_unknown')),
   cancel_requested_at timestamptz,terminal_at timestamptz,error_code varchar(64),custody_id uuid,
   lease_token uuid,lease_until timestamptz,fence bigint NOT NULL DEFAULT 0,technical_retries smallint NOT NULL DEFAULT 0 CHECK(technical_retries BETWEEN 0 AND 3),next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
   UNIQUE(organization_id,client_account_id,legal_entity_id,id),UNIQUE(organization_id,membership_id,legal_entity_id,idempotency_key),
   CHECK((direction='folio' AND folio IS NOT NULL AND content_type='xml' AND date_from IS NULL AND date_to IS NULL) OR (direction<>'folio' AND folio IS NULL AND date_from IS NOT NULL AND date_to IS NOT NULL AND date_to>=date_from)),
   CHECK(NOT(direction='received' AND content_type='xml') OR document_status='active'),
   FOREIGN KEY(organization_id,client_account_id,legal_entity_id) REFERENCES legal_entities(organization_id,client_account_id,id),
   FOREIGN KEY(organization_id,membership_id,user_id) REFERENCES memberships(organization_id,id,user_id),
   FOREIGN KEY(organization_id,client_account_id,legal_entity_id,custody_id) REFERENCES efirma_sessions(organization_id,client_account_id,legal_entity_id,id) ON DELETE SET NULL(custody_id)
  );
  CREATE INDEX ix_sat_jobs_due ON sat_download_jobs(next_attempt_at,id) WHERE terminal_at IS NULL;
  CREATE INDEX ix_sat_jobs_scope ON sat_download_jobs(organization_id,legal_entity_id,created_at,id);
  CREATE TABLE sat_requests(
   id uuid PRIMARY KEY,organization_id uuid NOT NULL,client_account_id uuid NOT NULL,legal_entity_id uuid NOT NULL,job_id uuid NOT NULL,
   external_id varchar(128),submission_started_at timestamptz,submission_completed_at timestamptz,submission_state varchar(16) NOT NULL DEFAULT 'not_sent' CHECK(submission_state IN('not_sent','sending','accepted','unknown','rejected')),
   sat_state smallint CHECK(sat_state BETWEEN 1 AND 6),sat_code varchar(16),sat_request_code varchar(16),cfdi_count bigint CHECK(cfdi_count>=0),verified_at timestamptz,
   UNIQUE(organization_id,client_account_id,legal_entity_id,id),UNIQUE(job_id),
   FOREIGN KEY(organization_id,client_account_id,legal_entity_id,job_id) REFERENCES sat_download_jobs(organization_id,client_account_id,legal_entity_id,id)
  );
  CREATE TABLE sat_packages(
   id uuid PRIMARY KEY,organization_id uuid NOT NULL,client_account_id uuid NOT NULL,legal_entity_id uuid NOT NULL,request_id uuid NOT NULL,external_id varchar(128) NOT NULL,
   ordinal integer NOT NULL CHECK(ordinal>0),status varchar(24) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','downloading','download_unknown','stored','processing','completed','with_issues','failed','expired','budget_exhausted')),
   download_attempts smallint NOT NULL DEFAULT 0 CHECK(download_attempts BETWEEN 0 AND 2),uncertain_attempts smallint NOT NULL DEFAULT 0 CHECK(uncertain_attempts BETWEEN 0 AND download_attempts),
   local_retry_count integer NOT NULL DEFAULT 0 CHECK(local_retry_count BETWEEN 0 AND 10),attempt_started_at timestamptz,downloaded_at timestamptz,object_id uuid,ingestion_job_id uuid,error_code varchar(64),retry_authorized boolean NOT NULL DEFAULT false,
   generated_at timestamptz,official_expires_at timestamptz,first_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
   UNIQUE(organization_id,client_account_id,legal_entity_id,id),UNIQUE(request_id,external_id),UNIQUE(request_id,ordinal),
   FOREIGN KEY(organization_id,client_account_id,legal_entity_id,request_id) REFERENCES sat_requests(organization_id,client_account_id,legal_entity_id,id),
   FOREIGN KEY(organization_id,client_account_id,legal_entity_id,object_id) REFERENCES stored_objects(organization_id,client_account_id,legal_entity_id,id),
   FOREIGN KEY(organization_id,client_account_id,legal_entity_id,ingestion_job_id) REFERENCES ingestion_jobs(organization_id,client_account_id,legal_entity_id,id)
  );
  CREATE INDEX ix_sat_packages_page ON sat_packages(organization_id,request_id,ordinal);
  CREATE TABLE sat_metadata_observations(
   id uuid PRIMARY KEY,organization_id uuid NOT NULL,client_account_id uuid NOT NULL,legal_entity_id uuid NOT NULL,package_id uuid NOT NULL,
   cfdi_uuid uuid NOT NULL,observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),issuer_rfc varchar(13) NOT NULL,receiver_rfc varchar(13) NOT NULL,
   issued_at timestamp NOT NULL,certified_at timestamp NOT NULL,total numeric(24,6) NOT NULL CHECK(total>=0),effect char(1) NOT NULL CHECK(effect IN('I','E','T','N','P')),
   sat_status varchar(12) NOT NULL CHECK(sat_status IN('active','cancelled')),cancelled_at timestamp,row_sha256 char(64) NOT NULL CHECK(row_sha256~'^[0-9a-f]{64}$'),
   UNIQUE(package_id,cfdi_uuid),UNIQUE(organization_id,client_account_id,legal_entity_id,id),
   FOREIGN KEY(organization_id,client_account_id,legal_entity_id,package_id) REFERENCES sat_packages(organization_id,client_account_id,legal_entity_id,id)
  );
  REVOKE UPDATE ON sat_metadata_observations FROM PUBLIC;
  CREATE INDEX ix_sat_metadata_uuid ON sat_metadata_observations(organization_id,legal_entity_id,cfdi_uuid,observed_at);
  `);
    await r.query(`CREATE FUNCTION sat_authorized(u uuid,s uuid,o uuid,m uuid,a uuid,e uuid,j uuid,purpose text,idle_seconds integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
   SELECT public.efirma_authorized(u,s,o,m,a,e,idle_seconds) AND EXISTS(SELECT 1 FROM public.sat_download_jobs job
    JOIN public.memberships member ON member.id=m AND member.organization_id=o JOIN public.permissions permission ON permission.key='sat.download' AND permission.status='active'
    WHERE job.id=j AND job.organization_id=o AND job.client_account_id=a AND job.legal_entity_id=e AND job.user_id=u AND job.membership_id=m
     AND job.terminal_at IS NULL AND job.cancel_requested_at IS NULL AND job.filter_version=1 AND purpose IN('sat.submit','sat.recover')
     AND NOT EXISTS(SELECT 1 FROM public.membership_permissions x WHERE x.organization_id=o AND x.membership_id=m AND x.permission_id=permission.id AND x.revoked_at IS NULL AND x.effect='deny')
     AND (EXISTS(SELECT 1 FROM public.membership_permissions x WHERE x.organization_id=o AND x.membership_id=m AND x.permission_id=permission.id AND x.revoked_at IS NULL AND x.effect='grant')
      OR EXISTS(SELECT 1 FROM public.role_permissions rp WHERE rp.role_id=member.role_id AND rp.permission_id=permission.id AND rp.enabled AND (rp.valid_from IS NULL OR rp.valid_from<=statement_timestamp()) AND (rp.valid_until IS NULL OR rp.valid_until>statement_timestamp())))) $$;
   ALTER FUNCTION sat_authorized(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer) OWNER TO balanz_fiscal_reconcile_owner;
   REVOKE ALL ON FUNCTION sat_authorized(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer) FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION sat_authorized(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer) TO balanz_api,balanz_worker;`);
    await r.query(
      `ALTER TABLE efirma_sessions DROP CONSTRAINT efirma_sessions_certificate_profile_check, ADD CONSTRAINT efirma_sessions_certificate_profile_check CHECK(certificate_profile IN('synthetic_v1','sat_efirma_v1'));`,
    );
    await r.query(`CREATE FUNCTION claim_sat_cleanup() RETURNS TABLE(object_id uuid,organization_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    DECLARE candidate record; BEGIN
    FOR candidate IN SELECT o.id FROM public.stored_objects o WHERE o.kind='sat_package' AND o.lifecycle_state<>'deleted'
      AND (o.retention_until<=clock_timestamp() OR (o.lifecycle_state='pending_upload' AND o.created_at<clock_timestamp()-interval '1 hour'))
      AND (o.hold_until IS NULL OR o.hold_until<=clock_timestamp()) AND o.malware_scan_status<>'infected'
      AND (o.cleanup_requested_at IS NULL OR o.cleanup_requested_at<clock_timestamp()-interval '5 minutes')
      AND NOT EXISTS(SELECT 1 FROM public.sat_packages p JOIN public.sat_requests r ON r.id=p.request_id JOIN public.sat_download_jobs j ON j.id=r.job_id WHERE p.object_id=o.id AND j.terminal_at IS NULL AND (o.lifecycle_state<>'pending_upload' OR j.lease_until>clock_timestamp()))
      AND NOT EXISTS(SELECT 1 FROM public.ingestion_jobs j WHERE j.root_object_id=o.id AND j.status IN('queued','processing','failed_retryable','cancel_requested'))
      AND NOT EXISTS(SELECT 1 FROM public.incidents i WHERE i.stored_object_id=o.id AND i.status='open')
      ORDER BY o.retention_until,o.id LIMIT 100 FOR UPDATE OF o SKIP LOCKED
    LOOP RETURN QUERY UPDATE public.stored_objects o SET lifecycle_state='rejected',cleanup_requested_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1
      WHERE o.id=candidate.id AND NOT EXISTS(SELECT 1 FROM public.sat_packages p JOIN public.sat_requests r ON r.id=p.request_id JOIN public.sat_download_jobs j ON j.id=r.job_id WHERE p.object_id=o.id AND j.terminal_at IS NULL AND (o.lifecycle_state<>'pending_upload' OR j.lease_until>clock_timestamp()))
      AND NOT EXISTS(SELECT 1 FROM public.ingestion_jobs j WHERE j.root_object_id=o.id AND j.status IN('queued','processing','failed_retryable','cancel_requested'))
      AND NOT EXISTS(SELECT 1 FROM public.incidents i WHERE i.stored_object_id=o.id AND i.status='open') RETURNING o.id,o.organization_id;
    END LOOP; END $$;
    ALTER FUNCTION claim_sat_cleanup() OWNER TO balanz_fiscal_reconcile_owner;REVOKE ALL ON FUNCTION claim_sat_cleanup() FROM PUBLIC;GRANT EXECUTE ON FUNCTION claim_sat_cleanup() TO balanz_worker;`);
    await r.query(`CREATE FUNCTION audit_sat_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
    INSERT INTO public.audit_events(organization_id,actor_type,service_principal,client_account_id,legal_entity_id,action,decision,object_type,object_id,correlation_id)
    VALUES(NEW.organization_id,'service','sat-process',NEW.client_account_id,NEW.legal_entity_id,'sat.'||NEW.status,'ALLOW','sat_download_job',NEW.id,gen_random_uuid());RETURN NEW;END $$;
    REVOKE ALL ON FUNCTION audit_sat_transition() FROM PUBLIC;
    CREATE TRIGGER tr_sat_transition AFTER UPDATE OF status ON sat_download_jobs FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION audit_sat_transition();`);
    await r.query(`CREATE FUNCTION enforce_sat_immutability() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
    IF ROW(NEW.id,NEW.organization_id,NEW.client_account_id,NEW.legal_entity_id) IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.client_account_id,OLD.legal_entity_id) THEN RAISE EXCEPTION 'immutable SAT scope' USING ERRCODE='23514';END IF;
    IF TG_TABLE_NAME='sat_download_jobs' THEN
      IF ROW(NEW.user_id,NEW.membership_id,NEW.idempotency_key,NEW.request_fingerprint,NEW.filter_version,NEW.direction,NEW.content_type,NEW.date_from,NEW.date_to,NEW.folio,NEW.document_type,NEW.document_status) IS DISTINCT FROM ROW(OLD.user_id,OLD.membership_id,OLD.idempotency_key,OLD.request_fingerprint,OLD.filter_version,OLD.direction,OLD.content_type,OLD.date_from,OLD.date_to,OLD.folio,OLD.document_type,OLD.document_status) OR NEW.technical_retries<OLD.technical_retries THEN RAISE EXCEPTION 'immutable SAT request identity' USING ERRCODE='23514';END IF;
    ELSIF TG_TABLE_NAME='sat_requests' THEN
      IF NEW.job_id<>OLD.job_id OR (OLD.external_id IS NOT NULL AND NEW.external_id IS DISTINCT FROM OLD.external_id) THEN RAISE EXCEPTION 'immutable SAT folio' USING ERRCODE='23514';END IF;
    ELSE
      IF ROW(NEW.request_id,NEW.external_id,NEW.ordinal) IS DISTINCT FROM ROW(OLD.request_id,OLD.external_id,OLD.ordinal) OR NEW.download_attempts<OLD.download_attempts OR NEW.uncertain_attempts<OLD.uncertain_attempts OR NEW.local_retry_count<OLD.local_retry_count OR (OLD.downloaded_at IS NOT NULL AND ROW(NEW.downloaded_at,NEW.object_id) IS DISTINCT FROM ROW(OLD.downloaded_at,OLD.object_id)) THEN RAISE EXCEPTION 'immutable SAT package authority' USING ERRCODE='23514';END IF;
    END IF;RETURN NEW;END $$;
    REVOKE ALL ON FUNCTION enforce_sat_immutability() FROM PUBLIC;
    CREATE TRIGGER tr_sat_job_immutable BEFORE UPDATE ON sat_download_jobs FOR EACH ROW EXECUTE FUNCTION enforce_sat_immutability();
    CREATE TRIGGER tr_sat_request_immutable BEFORE UPDATE ON sat_requests FOR EACH ROW EXECUTE FUNCTION enforce_sat_immutability();
    CREATE TRIGGER tr_sat_package_immutable BEFORE UPDATE ON sat_packages FOR EACH ROW EXECUTE FUNCTION enforce_sat_immutability();`);
    for (const table of [
      'sat_download_jobs',
      'sat_requests',
      'sat_packages',
      'sat_metadata_observations',
    ]) {
      await r.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
    CREATE POLICY ${table}_api ON ${table} TO balanz_api USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND EXISTS(SELECT 1 FROM memberships m WHERE m.id=nullif(current_setting('app.membership_id',true),'')::uuid AND m.organization_id=${table}.organization_id AND m.status='active')) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND EXISTS(SELECT 1 FROM memberships m WHERE m.id=nullif(current_setting('app.membership_id',true),'')::uuid AND m.organization_id=${table}.organization_id AND m.status='active'));
    CREATE POLICY ${table}_worker ON ${table} TO balanz_worker USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND current_setting('app.membership_id',true)='00000000-0000-0000-0000-000000000000') WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND current_setting('app.membership_id',true)='00000000-0000-0000-0000-000000000000');
    GRANT SELECT,INSERT,UPDATE ON ${table} TO balanz_api,balanz_worker;GRANT SELECT,UPDATE ON ${table} TO balanz_fiscal_reconcile_owner;`);
    }
    await r.query(
      `REVOKE UPDATE ON sat_metadata_observations FROM balanz_api,balanz_worker,balanz_fiscal_reconcile_owner;`,
    );
    for (const table of ['fiscal_reauth_grants', 'efirma_sessions'])
      await r.query(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_purpose_check,
    ADD sat_job_id uuid,ADD filter_version integer,
    ADD CONSTRAINT ${table}_purpose_check CHECK((purpose='efirma.prepare' AND sat_job_id IS NULL AND filter_version IS NULL) OR (purpose IN('sat.submit','sat.recover') AND sat_job_id IS NOT NULL AND filter_version IS NOT NULL AND filter_version=1)),
    ADD CONSTRAINT fk_${table}_sat_job FOREIGN KEY(organization_id,client_account_id,legal_entity_id,sat_job_id) REFERENCES sat_download_jobs(organization_id,client_account_id,legal_entity_id,id);`);
    await r.query(`ALTER TABLE efirma_sessions DROP CONSTRAINT efirma_sessions_envelope_version_check,
    ADD CONSTRAINT efirma_sessions_envelope_version_check CHECK((purpose='efirma.prepare' AND envelope_version=1) OR (purpose IN('sat.submit','sat.recover') AND envelope_version=2));
   CREATE FUNCTION sat_jobs_batch() RETURNS TABLE(id uuid,organization_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
    SELECT j.id,j.organization_id FROM public.sat_download_jobs j WHERE j.terminal_at IS NULL AND j.next_attempt_at<=statement_timestamp()
    AND (j.lease_until IS NULL OR j.lease_until<statement_timestamp()) AND (j.cancel_requested_at IS NOT NULL OR j.status IN('submitting','recovering','processing_local') OR EXISTS(SELECT 1 FROM public.sat_requests r JOIN public.sat_packages p ON p.request_id=r.id WHERE r.job_id=j.id AND p.status IN('stored','processing'))) ORDER BY j.next_attempt_at,j.id LIMIT 20 $$;
   ALTER FUNCTION sat_jobs_batch() OWNER TO balanz_fiscal_reconcile_owner;REVOKE ALL ON FUNCTION sat_jobs_batch() FROM PUBLIC;GRANT EXECUTE ON FUNCTION sat_jobs_batch() TO balanz_worker;
  `);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Forward-only SAT migration; use a reviewed corrective migration.',
      ),
    );
  }
}
