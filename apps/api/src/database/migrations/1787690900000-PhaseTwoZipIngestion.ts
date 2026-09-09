import { MigrationInterface, QueryRunner } from 'typeorm';

export class PhaseTwoZipIngestion1787690900000 implements MigrationInterface {
  name = 'PhaseTwoZipIngestion1787690900000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ingestion_uploads ADD COLUMN write_expires_at timestamptz`,
    );
    await runner.query(
      `ALTER TABLE stored_objects ADD COLUMN cleanup_requested_at timestamptz`,
    );
    await runner.query(`ALTER TABLE ingestion_items
      ADD COLUMN archive_path_sha256 char(64), ADD COLUMN compressed_size_bytes bigint,
      ADD COLUMN uncompressed_size_bytes bigint, ADD COLUMN compression_method smallint, ADD COLUMN directory_depth smallint,
      ADD CONSTRAINT ck_ingestion_items_archive CHECK (
        (archive_path_sha256 IS NULL AND compressed_size_bytes IS NULL AND uncompressed_size_bytes IS NULL AND compression_method IS NULL AND directory_depth IS NULL)
        OR (archive_path_sha256 IS NOT NULL AND archive_path_sha256 ~ '^[0-9a-f]{64}$'
          AND compressed_size_bytes IS NOT NULL AND compressed_size_bytes BETWEEN 0 AND 52428800
          AND uncompressed_size_bytes IS NOT NULL AND uncompressed_size_bytes BETWEEN 0 AND 262144000
          AND compression_method IS NOT NULL AND compression_method IN (0,8)
          AND directory_depth IS NOT NULL AND directory_depth BETWEEN 0 AND 2))`);
    await runner.query(
      `CREATE INDEX ix_ingestion_items_job_result_ordinal ON ingestion_items (organization_id,ingestion_job_id,product_result,ordinal,id)`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX uq_manual_zip_initial_upload ON ingestion_jobs (organization_id,upload_id) WHERE source_type='manual_zip' AND retry_of_job_id IS NULL`,
    );
    await runner.query(
      `CREATE INDEX ix_zip_cleanup_due ON stored_objects (retention_until,id) WHERE kind IN ('manual_zip','extracted_xml') AND lifecycle_state<>'deleted'`,
    );
    for (const table of [
      'ingestion_uploads',
      'ingestion_items',
      'stored_objects',
    ]) {
      await runner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await runner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
    await runner.query(
      `GRANT SELECT (write_expires_at), UPDATE (write_expires_at) ON ingestion_uploads TO balanz_api`,
    );
    await runner.query(
      `GRANT SELECT (id,organization_id,client_account_id,legal_entity_id,object_id,state,upload_type) ON ingestion_uploads TO balanz_worker`,
    );
    await runner.query(
      `GRANT INSERT (archive_path_sha256,compressed_size_bytes,uncompressed_size_bytes,compression_method,directory_depth) ON ingestion_items TO balanz_worker`,
    );
    await runner.query(`GRANT INSERT (id,organization_id,client_account_id,legal_entity_id,kind,storage_provider,storage_container,object_key,encryption_class,declared_mime_type,retention_until)
      ON stored_objects TO balanz_worker`);
    await runner.query(
      `GRANT UPDATE (size_bytes,sha256,uploaded_at,deleted_at,cleanup_requested_at) ON stored_objects TO balanz_worker`,
    );
    await runner.query(
      `GRANT SELECT (cleanup_requested_at) ON stored_objects TO balanz_api,balanz_worker`,
    );
    await runner.query(
      `GRANT UPDATE (cleanup_requested_at) ON stored_objects TO balanz_fiscal_reconcile_owner`,
    );
    await runner.query(
      `GRANT SELECT (organization_id,stored_object_id,status) ON incidents TO balanz_fiscal_reconcile_owner`,
    );
    await runner.query(
      `GRANT SELECT (organization_id,source_object_id) ON cfdis TO balanz_fiscal_reconcile_owner`,
    );
    // Narrow trigger has no callable data API: only terminal transitions of ZIP
    // jobs can invoke it. Covers worker completion, queued cancellation and lease recovery.
    await runner.query(`CREATE FUNCTION public.finalize_manual_zip_items() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
      BEGIN
        UPDATE public.ingestion_items SET technical_status='terminal',product_result='internal_error',
          error_code=CASE WHEN NEW.status='cancelled' THEN 'ZIP_CANCELLED' ELSE COALESCE(NEW.last_error_code,'UNEXPECTED_WORKER_ERROR') END,
          processed_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1
          WHERE organization_id=NEW.organization_id AND ingestion_job_id=NEW.id AND technical_status<>'terminal';
        SELECT count(*)::integer,0,0,
          count(*) FILTER(WHERE product_result='incorporated')::integer,count(*) FILTER(WHERE product_result='duplicate')::integer,
          count(*) FILTER(WHERE product_result='foreign')::integer,count(*) FILTER(WHERE product_result='invalid')::integer,
          count(*) FILTER(WHERE product_result='unsupported')::integer,count(*) FILTER(WHERE product_result='internal_error')::integer
          INTO NEW.total_items,NEW.pending_items,NEW.processing_items,NEW.incorporated_items,NEW.duplicate_items,NEW.foreign_items,NEW.invalid_items,NEW.unsupported_items,NEW.internal_error_items
          FROM public.ingestion_items WHERE organization_id=NEW.organization_id AND ingestion_job_id=NEW.id;
        NEW.counters_reconciled_at=clock_timestamp(); NEW.current_stage=NULL;
        UPDATE public.stored_objects object SET retention_until=COALESCE(object.retention_until,clock_timestamp()+interval '30 days')
          WHERE object.organization_id=NEW.organization_id AND object.id=NEW.root_object_id AND object.kind='manual_zip';
        UPDATE public.stored_objects object SET retention_until=LEAST(COALESCE(object.retention_until,clock_timestamp()+interval '1 day'),clock_timestamp()+interval '1 day')
          WHERE object.organization_id=NEW.organization_id AND object.kind='extracted_xml' AND object.lifecycle_state<>'available'
            AND object.malware_scan_status<>'infected' AND NEW.status IN ('cancelled','failed_final')
            AND EXISTS(SELECT 1 FROM public.ingestion_items item WHERE item.organization_id=NEW.organization_id AND item.ingestion_job_id=NEW.id AND item.object_id=object.id);
        RETURN NEW;
      END $$`);
    await runner.query(
      `ALTER FUNCTION public.finalize_manual_zip_items() OWNER TO balanz_fiscal_reconcile_owner`,
    );
    await runner.query(
      `REVOKE ALL ON FUNCTION public.finalize_manual_zip_items() FROM PUBLIC`,
    );
    await runner.query(`CREATE TRIGGER tr_finalize_manual_zip_items BEFORE UPDATE OF status ON ingestion_jobs FOR EACH ROW
      WHEN (NEW.source_type='manual_zip' AND NEW.status IN ('completed','completed_with_issues','failed_final','cancelled') AND OLD.status IS DISTINCT FROM NEW.status)
      EXECUTE FUNCTION public.finalize_manual_zip_items()`);
    // Only technical IDs leave this bounded maintenance boundary. Byte access
    // and the eventual deleted transition use normal worker RLS transactions.
    await runner.query(`CREATE FUNCTION public.claim_zip_cleanup() RETURNS TABLE(object_id uuid,organization_id uuid)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
      DECLARE candidate record;
      BEGIN
      FOR candidate IN
        SELECT object.id FROM public.stored_objects object
        WHERE object.kind IN ('manual_zip','extracted_xml') AND object.lifecycle_state<>'deleted'
          AND (object.retention_until<=clock_timestamp() OR (object.lifecycle_state IN ('pending_upload','rejected') AND object.created_at<clock_timestamp()-interval '31 days'))
          AND (object.hold_until IS NULL OR object.hold_until<=clock_timestamp()) AND object.malware_scan_status<>'infected'
          AND (object.cleanup_requested_at IS NULL OR object.cleanup_requested_at<clock_timestamp()-interval '5 minutes')
          AND NOT EXISTS(SELECT 1 FROM public.cfdis cfdi WHERE cfdi.organization_id=object.organization_id AND cfdi.source_object_id=object.id)
          AND NOT EXISTS(SELECT 1 FROM public.incidents incident WHERE incident.organization_id=object.organization_id AND incident.stored_object_id=object.id AND incident.status='open')
          AND NOT EXISTS(SELECT 1 FROM public.ingestion_uploads upload WHERE upload.organization_id=object.organization_id AND upload.object_id=object.id
            AND upload.state IN ('pending','receiving','uploaded') AND upload.upload_expires_at>clock_timestamp())
          AND NOT EXISTS(SELECT 1 FROM public.ingestion_jobs job WHERE job.organization_id=object.organization_id
            AND job.status IN ('awaiting_upload','queued','processing','failed_retryable','cancel_requested')
            AND (job.root_object_id=object.id OR EXISTS(SELECT 1 FROM public.ingestion_items item WHERE item.organization_id=job.organization_id AND item.ingestion_job_id=job.id AND item.object_id=object.id)))
        ORDER BY object.retention_until NULLS LAST,object.id LIMIT 100 FOR UPDATE OF object SKIP LOCKED
      LOOP
        -- A separate command takes a fresh READ COMMITTED snapshot after the
        -- object lock. A concurrently admitted retry must be visible here.
        RETURN QUERY
        UPDATE public.stored_objects object SET cleanup_requested_at=clock_timestamp(),lifecycle_state='rejected',updated_at=clock_timestamp(),version=version+1
        WHERE object.id=candidate.id
          AND NOT EXISTS(SELECT 1 FROM public.ingestion_jobs job WHERE job.organization_id=object.organization_id
            AND job.status IN ('awaiting_upload','queued','processing','failed_retryable','cancel_requested')
            AND (job.root_object_id=object.id OR EXISTS(SELECT 1 FROM public.ingestion_items item WHERE item.organization_id=job.organization_id AND item.ingestion_job_id=job.id AND item.object_id=object.id)))
          AND NOT EXISTS(SELECT 1 FROM public.cfdis cfdi WHERE cfdi.organization_id=object.organization_id AND cfdi.source_object_id=object.id)
          AND NOT EXISTS(SELECT 1 FROM public.incidents incident WHERE incident.organization_id=object.organization_id AND incident.stored_object_id=object.id AND incident.status='open')
        RETURNING object.id,object.organization_id;
      END LOOP;
      END $$`);
    await runner.query(
      `ALTER FUNCTION public.claim_zip_cleanup() OWNER TO balanz_fiscal_reconcile_owner`,
    );
    await runner.query(
      `REVOKE ALL ON FUNCTION public.claim_zip_cleanup() FROM PUBLIC`,
    );
    await runner.query(
      `GRANT EXECUTE ON FUNCTION public.claim_zip_cleanup() TO balanz_worker`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `REVOKE SELECT (id,organization_id,client_account_id,legal_entity_id,object_id,state,upload_type) ON ingestion_uploads FROM balanz_worker`,
    );
    await runner.query(
      `REVOKE INSERT (id,organization_id,client_account_id,legal_entity_id,kind,storage_provider,storage_container,object_key,encryption_class,declared_mime_type,retention_until) ON stored_objects FROM balanz_worker`,
    );
    await runner.query(
      `REVOKE UPDATE (size_bytes,sha256,uploaded_at,deleted_at) ON stored_objects FROM balanz_worker`,
    );
    await runner.query(
      `REVOKE SELECT (organization_id,stored_object_id,status) ON incidents FROM balanz_fiscal_reconcile_owner`,
    );
    await runner.query(
      `REVOKE SELECT (organization_id,source_object_id) ON cfdis FROM balanz_fiscal_reconcile_owner`,
    );
    await runner.query(
      `DROP TRIGGER tr_finalize_manual_zip_items ON ingestion_jobs`,
    );
    await runner.query(`DROP FUNCTION public.finalize_manual_zip_items()`);
    await runner.query(`DROP FUNCTION public.claim_zip_cleanup()`);
    await runner.query(`DROP INDEX ix_zip_cleanup_due`);
    await runner.query(`DROP INDEX uq_manual_zip_initial_upload`);
    await runner.query(`DROP INDEX ix_ingestion_items_job_result_ordinal`);
    await runner.query(`ALTER TABLE ingestion_items DROP CONSTRAINT ck_ingestion_items_archive,DROP COLUMN archive_path_sha256,
      DROP COLUMN compressed_size_bytes,DROP COLUMN uncompressed_size_bytes,DROP COLUMN compression_method,DROP COLUMN directory_depth`);
    await runner.query(
      `ALTER TABLE stored_objects DROP COLUMN cleanup_requested_at`,
    );
    await runner.query(
      `ALTER TABLE ingestion_uploads DROP COLUMN write_expires_at`,
    );
  }
}
