import { MigrationInterface, QueryRunner } from 'typeorm';

/** Shared history is append-only. Runtime identities cannot rewrite decisions or closes. */
export class PhaseFiveMonthlyWorkspace1787691200000 implements MigrationInterface {
  name = 'PhaseFiveMonthlyWorkspace1787691200000';
  async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TABLE permissions DROP CONSTRAINT permissions_key_format_chk,
      ADD CONSTRAINT permissions_key_format_chk CHECK(key ~ '^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$' OR key='cfdi.categories.manage');
      CREATE FUNCTION monthly_permission(o uuid, k text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
      SELECT EXISTS(SELECT 1 FROM public.memberships m JOIN public.organizations org ON org.id=m.organization_id
        JOIN public.permissions p ON p.key=k AND p.status='active'
        WHERE m.id=nullif(current_setting('app.membership_id',true),'')::uuid AND m.organization_id=o AND m.status='active' AND org.status='active'
        AND NOT EXISTS(SELECT 1 FROM public.membership_permissions mp WHERE mp.organization_id=o AND mp.membership_id=m.id AND mp.permission_id=p.id AND mp.revoked_at IS NULL AND mp.effect='deny')
        AND (EXISTS(SELECT 1 FROM public.membership_permissions mp WHERE mp.organization_id=o AND mp.membership_id=m.id AND mp.permission_id=p.id AND mp.revoked_at IS NULL AND mp.effect='grant')
          OR EXISTS(SELECT 1 FROM public.role_permissions rp WHERE rp.role_id=m.role_id AND rp.permission_id=p.id AND (k<>'cfdi.categories.manage' OR org.owner_user_id=m.user_id) AND rp.enabled AND (rp.valid_from IS NULL OR rp.valid_from<=statement_timestamp()) AND (rp.valid_until IS NULL OR rp.valid_until>statement_timestamp())))) $$;
      CREATE FUNCTION monthly_scope(o uuid,a uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
        SELECT o=nullif(current_setting('app.organization_id',true),'')::uuid AND EXISTS(
          SELECT 1 FROM public.memberships m JOIN public.organizations org ON org.id=m.organization_id
          JOIN public.client_accounts account ON account.organization_id=o AND account.id=a AND account.status='active'
          WHERE m.id=nullif(current_setting('app.membership_id',true),'')::uuid AND m.organization_id=o AND m.status='active' AND org.status='active'
          AND (org.owner_user_id=m.user_id OR EXISTS(SELECT 1 FROM public.account_assignments aa WHERE aa.organization_id=o AND aa.client_account_id=a AND aa.membership_id=m.id AND aa.status='active'))) $$;
      ALTER FUNCTION monthly_permission(uuid,text) OWNER TO balanz_fiscal_reconcile_owner;
      ALTER FUNCTION monthly_scope(uuid,uuid) OWNER TO balanz_fiscal_reconcile_owner;
      REVOKE ALL ON FUNCTION monthly_permission(uuid,text),monthly_scope(uuid,uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION monthly_permission(uuid,text),monthly_scope(uuid,uuid) TO balanz_api,balanz_worker;
      CREATE TABLE cfdi_categories(
        id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),label varchar(80) NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 80),
        archived boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by uuid NOT NULL,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE(organization_id,id),FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,id));
      CREATE UNIQUE INDEX ix_monthly_category_label ON cfdi_categories(organization_id,lower(label)) WHERE NOT archived;
      CREATE TABLE monthly_checklist_templates(
        id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),version integer NOT NULL CHECK(version>0),
        item_keys text[] NOT NULL CHECK(cardinality(item_keys) BETWEEN 7 AND 12 AND item_keys <@ ARRAY['documents_reviewed','exclusions_reasoned','sources_settled','integrity_resolved','relationships_reviewed','scope_confirmed','snapshot_ready','client_clarifications','professional_review']::text[]),
        created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(organization_id,id),UNIQUE(organization_id,version),
        FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,id));
    `);
    const scope = `organization_id uuid NOT NULL,client_account_id uuid NOT NULL,legal_entity_id uuid NOT NULL,period_id uuid NOT NULL,
      FOREIGN KEY(organization_id,client_account_id,legal_entity_id,period_id) REFERENCES periods(organization_id,client_account_id,legal_entity_id,id)`;
    await r.query(`CREATE TABLE monthly_workspaces(
      id uuid PRIMARY KEY,${scope},UNIQUE(period_id),UNIQUE(organization_id,client_account_id,legal_entity_id,id),
      version integer NOT NULL DEFAULT 0 CHECK(version>=0),template_id uuid,template_keys text[] NOT NULL,
      lease_session_id uuid REFERENCES auth_sessions(id),lease_membership_id uuid,lease_instance_hash char(64),lease_until timestamptz,
      prepared_fingerprint char(64),latest_close_id uuid,
      FOREIGN KEY(organization_id,template_id) REFERENCES monthly_checklist_templates(organization_id,id),
      FOREIGN KEY(organization_id,lease_membership_id) REFERENCES memberships(organization_id,id),
      CHECK((lease_session_id IS NULL AND lease_membership_id IS NULL AND lease_instance_hash IS NULL AND lease_until IS NULL) OR (lease_session_id IS NOT NULL AND lease_membership_id IS NOT NULL AND lease_instance_hash IS NOT NULL AND lease_until IS NOT NULL)));
      CREATE TABLE monthly_decisions(
        id uuid PRIMARY KEY,${scope},participation_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),
        review_status varchar(12) NOT NULL CHECK(review_status IN('pending','reviewed')),inclusion varchar(12) NOT NULL CHECK(inclusion IN('included','excluded')),
        exclusion_reason varchar(1000),category_id uuid,category_label varchar(80),
        tax_status varchar(16) NOT NULL DEFAULT 'pendiente' CHECK(tax_status IN('pendiente','no_aplica','documentado')),tax_note varchar(1000),
        vat_status varchar(16) NOT NULL DEFAULT 'pendiente' CHECK(vat_status IN('pendiente','no_aplica','documentado')),vat_note varchar(1000),comment varchar(2000),
        actor_user_id uuid NOT NULL,actor_membership_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        policy_version varchar(64) NOT NULL DEFAULT 'monthly-decision/1.0.0' CHECK(policy_version='monthly-decision/1.0.0'),
        UNIQUE(organization_id,client_account_id,legal_entity_id,id),UNIQUE(participation_id,version),
        FOREIGN KEY(organization_id,client_account_id,legal_entity_id,participation_id) REFERENCES period_cfdis(organization_id,client_account_id,legal_entity_id,id),
        FOREIGN KEY(organization_id,category_id) REFERENCES cfdi_categories(organization_id,id),
        FOREIGN KEY(organization_id,actor_membership_id,actor_user_id) REFERENCES memberships(organization_id,id,user_id),
        CHECK(inclusion<>'excluded' OR length(btrim(exclusion_reason))>0),CHECK(tax_status<>'documentado' OR length(btrim(tax_note))>0),CHECK(vat_status<>'documentado' OR length(btrim(vat_note))>0));
      CREATE INDEX ix_monthly_decision_latest ON monthly_decisions(organization_id,period_id,participation_id,version DESC);
      CREATE TABLE monthly_incident_events(
        id uuid PRIMARY KEY,${scope},incident_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),
        state varchar(24) NOT NULL CHECK(state IN('open','client_clarification','resolved','reviewed_rejection')),
        responsible_membership_id uuid,reason varchar(1000) NOT NULL CHECK(length(btrim(reason))>0),comment varchar(2000),
        actor_user_id uuid NOT NULL,actor_membership_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE(organization_id,client_account_id,legal_entity_id,id),UNIQUE(period_id,incident_id,version),
        FOREIGN KEY(organization_id,client_account_id,legal_entity_id,incident_id) REFERENCES incidents(organization_id,client_account_id,legal_entity_id,id),
        FOREIGN KEY(organization_id,responsible_membership_id) REFERENCES memberships(organization_id,id),
        FOREIGN KEY(organization_id,actor_membership_id,actor_user_id) REFERENCES memberships(organization_id,id,user_id));
      CREATE INDEX ix_monthly_incident_latest ON monthly_incident_events(organization_id,period_id,incident_id,version DESC);
      CREATE TABLE monthly_checklist_events(
        id uuid PRIMARY KEY,${scope},item_key varchar(40) NOT NULL CHECK(item_key IN('relationships_reviewed','scope_confirmed','client_clarifications','professional_review')),
        version integer NOT NULL CHECK(version>0),confirmed boolean NOT NULL,reason varchar(1000) NOT NULL CHECK(length(btrim(reason))>0),
        actor_user_id uuid NOT NULL,actor_membership_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE(organization_id,client_account_id,legal_entity_id,id),UNIQUE(period_id,item_key,version),
        FOREIGN KEY(organization_id,actor_membership_id,actor_user_id) REFERENCES memberships(organization_id,id,user_id));
      CREATE INDEX ix_monthly_checklist_latest ON monthly_checklist_events(organization_id,period_id,item_key,version DESC);
      CREATE TABLE monthly_source_links(
        id uuid PRIMARY KEY,${scope},ingestion_job_id uuid,sat_job_id uuid,reason varchar(1000) NOT NULL CHECK(length(btrim(reason))>0),
        actor_membership_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CHECK(num_nonnulls(ingestion_job_id,sat_job_id)=1),UNIQUE(period_id,ingestion_job_id),UNIQUE(period_id,sat_job_id),
        FOREIGN KEY(organization_id,client_account_id,legal_entity_id,ingestion_job_id) REFERENCES ingestion_jobs(organization_id,client_account_id,legal_entity_id,id),
        FOREIGN KEY(organization_id,client_account_id,legal_entity_id,sat_job_id) REFERENCES sat_download_jobs(organization_id,client_account_id,legal_entity_id,id),
        FOREIGN KEY(organization_id,actor_membership_id) REFERENCES memberships(organization_id,id));
      CREATE TABLE monthly_closes(
        id uuid PRIMARY KEY,${scope},version integer NOT NULL CHECK(version>0),workspace_version integer NOT NULL CHECK(workspace_version>=0),
        schema_version varchar(40) NOT NULL CHECK(schema_version='monthly-close/1.0.0'),fingerprint char(64) NOT NULL,
        snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND snapshot->>'schemaVersion'='monthly-close/1.0.0'),
        source_exception_reason varchar(1000),actor_user_id uuid NOT NULL,actor_membership_id uuid NOT NULL,closed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE(organization_id,client_account_id,legal_entity_id,id),UNIQUE(period_id,version),
        FOREIGN KEY(organization_id,actor_membership_id,actor_user_id) REFERENCES memberships(organization_id,id,user_id));
      CREATE INDEX ix_monthly_closes_page ON monthly_closes(organization_id,period_id,version DESC);
      ALTER TABLE monthly_workspaces ADD FOREIGN KEY(organization_id,client_account_id,legal_entity_id,latest_close_id) REFERENCES monthly_closes(organization_id,client_account_id,legal_entity_id,id);
      CREATE TABLE monthly_operations(
        id uuid PRIMARY KEY,${scope},actor_membership_id uuid NOT NULL,idempotency_key varchar(128) NOT NULL,operation varchar(32) NOT NULL,
        fingerprint char(64) NOT NULL,response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE(organization_id,actor_membership_id,period_id,idempotency_key),
        FOREIGN KEY(organization_id,actor_membership_id) REFERENCES memberships(organization_id,id));
    `);
    for (const table of [
      'monthly_workspaces',
      'monthly_decisions',
      'monthly_incident_events',
      'monthly_checklist_events',
      'monthly_source_links',
      'monthly_closes',
      'monthly_operations',
    ]) {
      const payroll =
        table === 'monthly_decisions'
          ? ` AND (monthly_permission(organization_id,'payroll.view') OR NOT EXISTS(SELECT 1 FROM period_cfdis pc JOIN cfdis c ON c.id=pc.cfdi_id WHERE pc.id=participation_id AND c.document_type='N'))`
          : '';
      await r.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY ${table}_api ON ${table} TO balanz_api USING(monthly_scope(organization_id,client_account_id)${payroll}) WITH CHECK(monthly_scope(organization_id,client_account_id)${payroll});
        GRANT SELECT,INSERT ON ${table} TO balanz_api;
        GRANT SELECT ON ${table} TO balanz_fiscal_reconcile_owner;
        CREATE INDEX ix_${table}_period ON ${table}(organization_id,period_id);`);
    }
    await r.query('GRANT UPDATE ON monthly_workspaces TO balanz_api');
    for (const table of ['cfdi_categories', 'monthly_checklist_templates']) {
      await r.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY ${table}_api ON ${table} TO balanz_api USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND monthly_permission(organization_id,'cfdi.view')) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND monthly_permission(organization_id,'cfdi.view'));
        GRANT SELECT,INSERT ON ${table} TO balanz_api;`);
    }
    await r.query(`GRANT UPDATE ON cfdi_categories TO balanz_api;
      CREATE FUNCTION monthly_immutable_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
        IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id THEN RAISE EXCEPTION 'immutable monthly identity' USING ERRCODE='23514'; END IF;
        IF TG_TABLE_NAME='monthly_workspaces' THEN IF ROW(NEW.client_account_id,NEW.legal_entity_id,NEW.period_id,NEW.template_id,NEW.template_keys) IS DISTINCT FROM ROW(OLD.client_account_id,OLD.legal_entity_id,OLD.period_id,OLD.template_id,OLD.template_keys) THEN RAISE EXCEPTION 'immutable monthly scope' USING ERRCODE='23514';END IF;END IF;RETURN NEW;END $$;
      REVOKE ALL ON FUNCTION monthly_immutable_scope() FROM PUBLIC;
      CREATE TRIGGER tr_monthly_workspace_scope BEFORE UPDATE ON monthly_workspaces FOR EACH ROW EXECUTE FUNCTION monthly_immutable_scope();
      CREATE TRIGGER tr_monthly_category_scope BEFORE UPDATE ON cfdi_categories FOR EACH ROW EXECUTE FUNCTION monthly_immutable_scope();
    `);
    await r.query(`ALTER TABLE period_cfdis ADD CONSTRAINT uq_period_cfdis_scoped_period_id UNIQUE(organization_id,client_account_id,legal_entity_id,period_id,id);
      ALTER TABLE monthly_decisions ADD FOREIGN KEY(organization_id,client_account_id,legal_entity_id,period_id,participation_id) REFERENCES period_cfdis(organization_id,client_account_id,legal_entity_id,period_id,id);
      ALTER TABLE monthly_decisions ADD CHECK(inclusion<>'excluded' OR exclusion_reason IS NOT NULL),ADD CHECK(tax_status<>'documentado' OR tax_note IS NOT NULL),ADD CHECK(vat_status<>'documentado' OR vat_note IS NOT NULL);
      CREATE TABLE cfdi_period_intents(
       id uuid PRIMARY KEY,organization_id uuid NOT NULL,client_account_id uuid NOT NULL,legal_entity_id uuid NOT NULL,cfdi_id uuid NOT NULL,
       participation_type varchar(24) NOT NULL CHECK(participation_type IN('document_issue','payment','payroll')),source_ordinal integer NOT NULL CHECK(source_ordinal>0),
       literal_date varchar(35) NOT NULL,source_date timestamptz NOT NULL,source_year integer NOT NULL CHECK(source_year BETWEEN 1900 AND 9999),source_month smallint NOT NULL CHECK(source_month BETWEEN 1 AND 12),
       timezone varchar(64) NOT NULL,policy_version varchar(64) NOT NULL CHECK(policy_version='cfdi-period-participation/1.0.0'),
       UNIQUE(organization_id,client_account_id,legal_entity_id,cfdi_id,participation_type,source_ordinal),
       FOREIGN KEY(organization_id,client_account_id,legal_entity_id,cfdi_id) REFERENCES cfdis(organization_id,client_account_id,legal_entity_id,id));
      CREATE TABLE cfdi_period_reconciliations(
       cfdi_id uuid PRIMARY KEY,organization_id uuid NOT NULL,client_account_id uuid NOT NULL,legal_entity_id uuid NOT NULL,
       status varchar(12) NOT NULL CHECK(status IN('legacy','ready','resolved','failed')),lease_token uuid,lease_until timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
       resolved_at timestamptz,error_code varchar(64),attempts integer NOT NULL DEFAULT 0,
       FOREIGN KEY(organization_id,client_account_id,legal_entity_id,cfdi_id) REFERENCES cfdis(organization_id,client_account_id,legal_entity_id,id));
      CREATE INDEX ix_cfdi_period_intents_due ON cfdi_period_intents(organization_id,legal_entity_id,source_year,source_month);
      CREATE INDEX ix_cfdi_period_reconcile_due ON cfdi_period_reconciliations(next_attempt_at,cfdi_id) WHERE status<>'resolved';
    `);
    for (const table of ['cfdi_period_intents', 'cfdi_period_reconciliations'])
      await r.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY ${table}_api ON ${table} TO balanz_api USING(monthly_scope(organization_id,client_account_id) AND (monthly_permission(organization_id,'payroll.view') OR NOT EXISTS(SELECT 1 FROM cfdis c WHERE c.id=cfdi_id AND c.document_type='N')));
      CREATE POLICY ${table}_worker ON ${table} TO balanz_worker USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND current_setting('app.membership_id',true)='00000000-0000-0000-0000-000000000000') WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND current_setting('app.membership_id',true)='00000000-0000-0000-0000-000000000000');
      CREATE POLICY ${table}_reconciler ON ${table} TO balanz_fiscal_reconcile_owner USING(true) WITH CHECK(true);
      GRANT SELECT ON ${table} TO balanz_api;GRANT SELECT,INSERT ON ${table} TO balanz_worker,balanz_fiscal_reconcile_owner;`);
    await r.query(`GRANT UPDATE ON cfdi_period_reconciliations TO balanz_worker,balanz_fiscal_reconcile_owner;
      GRANT SELECT(id,organization_id,client_account_id,legal_entity_id) ON cfdis TO balanz_fiscal_reconcile_owner; GRANT SELECT(cfdi_id,code) ON incidents TO balanz_fiscal_reconcile_owner; CREATE FUNCTION claim_monthly_reconciliation() RETURNS TABLE(cfdi_id uuid,organization_id uuid,lease_token uuid,status varchar) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
       INSERT INTO public.cfdi_period_reconciliations(cfdi_id,organization_id,client_account_id,legal_entity_id,status)
       SELECT c.id,c.organization_id,c.client_account_id,c.legal_entity_id,'legacy' FROM public.cfdis c WHERE EXISTS(SELECT 1 FROM public.incidents i WHERE i.cfdi_id=c.id AND i.code='FISCAL_PERIOD_NOT_CONFIGURED') AND NOT EXISTS(SELECT 1 FROM public.cfdi_period_reconciliations x WHERE x.cfdi_id=c.id) ORDER BY c.id LIMIT 25 ON CONFLICT DO NOTHING;
       RETURN QUERY WITH candidates AS(SELECT x.cfdi_id FROM public.cfdi_period_reconciliations x WHERE x.status<>'resolved' AND x.next_attempt_at<=clock_timestamp() AND (x.lease_until IS NULL OR x.lease_until<clock_timestamp()) ORDER BY x.next_attempt_at,x.cfdi_id LIMIT 25 FOR UPDATE SKIP LOCKED)
       UPDATE public.cfdi_period_reconciliations x SET lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1,next_attempt_at=clock_timestamp()+interval '1 minute' FROM candidates c WHERE c.cfdi_id=x.cfdi_id RETURNING x.cfdi_id,x.organization_id,x.lease_token,x.status;END $$;
      ALTER FUNCTION claim_monthly_reconciliation() OWNER TO balanz_fiscal_reconcile_owner;REVOKE ALL ON FUNCTION claim_monthly_reconciliation() FROM PUBLIC;GRANT EXECUTE ON FUNCTION claim_monthly_reconciliation() TO balanz_worker;
      CREATE FUNCTION monthly_arrival() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
       UPDATE public.periods SET status=(CASE WHEN status='closed' THEN 'changes_detected' ELSE 'preparation' END)::public.periods_status_enum,lock_version=lock_version+1 WHERE id=NEW.period_id AND organization_id=NEW.organization_id AND status IN('closed','ready_to_close');RETURN NEW;END $$;
      ALTER FUNCTION monthly_arrival() OWNER TO balanz_fiscal_reconcile_owner;GRANT UPDATE(status,lock_version),SELECT(id,organization_id,status,lock_version) ON periods TO balanz_fiscal_reconcile_owner;
      REVOKE ALL ON FUNCTION monthly_arrival() FROM PUBLIC;CREATE TRIGGER tr_monthly_participation_arrival AFTER INSERT ON period_cfdis FOR EACH ROW EXECUTE FUNCTION monthly_arrival();
    `);

    await r.query(`DROP POLICY monthly_closes_api ON monthly_closes;
      CREATE POLICY monthly_closes_api ON monthly_closes TO balanz_api USING(monthly_scope(organization_id,client_account_id) AND monthly_permission(organization_id,'cfdi.view') AND (monthly_permission(organization_id,'payroll.view') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'participations') item WHERE item->>'documentType'='N'))) WITH CHECK(monthly_scope(organization_id,client_account_id) AND (monthly_permission(organization_id,'payroll.view') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'participations') item WHERE item->>'documentType'='N')));
      DROP POLICY monthly_operations_api ON monthly_operations;
      CREATE POLICY monthly_operations_api ON monthly_operations TO balanz_api USING(monthly_scope(organization_id,client_account_id) AND actor_membership_id=nullif(current_setting('app.membership_id',true),'')::uuid) WITH CHECK(monthly_scope(organization_id,client_account_id) AND actor_membership_id=nullif(current_setting('app.membership_id',true),'')::uuid);
      DROP POLICY monthly_incident_events_api ON monthly_incident_events;
      CREATE POLICY monthly_incident_events_api ON monthly_incident_events TO balanz_api USING(monthly_scope(organization_id,client_account_id) AND (monthly_permission(organization_id,'payroll.view') OR NOT EXISTS(SELECT 1 FROM incidents i LEFT JOIN cfdis c ON c.id=i.cfdi_id LEFT JOIN ingestion_items it ON it.id=i.ingestion_item_id WHERE i.id=incident_id AND coalesce(c.document_type,it.document_type)='N'))) WITH CHECK(monthly_scope(organization_id,client_account_id) AND (monthly_permission(organization_id,'payroll.view') OR NOT EXISTS(SELECT 1 FROM incidents i LEFT JOIN cfdis c ON c.id=i.cfdi_id LEFT JOIN ingestion_items it ON it.id=i.ingestion_item_id WHERE i.id=incident_id AND coalesce(c.document_type,it.document_type)='N')));
    `);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error('Forward-only monthly migration; use a corrective migration.'),
    );
  }
}
