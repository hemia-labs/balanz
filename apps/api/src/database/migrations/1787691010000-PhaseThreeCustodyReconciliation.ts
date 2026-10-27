import { MigrationInterface, QueryRunner } from 'typeorm';

/** Append-only correction: PhaseThreeEfirmaCustody has already been shared. */
export class PhaseThreeCustodyReconciliation1787691010000 implements MigrationInterface {
  name = 'PhaseThreeCustodyReconciliation1787691010000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE INDEX ix_efirma_pending_reconcile ON efirma_sessions(reconciled_at NULLS FIRST,id)
      WHERE cleanup_completed_at IS NULL;
      DROP INDEX ix_efirma_cleanup`);
    await runner.query(`CREATE OR REPLACE FUNCTION efirma_reconciliation_batch() RETURNS TABLE(id uuid,organization_id uuid)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
        DELETE FROM public.fiscal_reauth_grants g WHERE g.id IN (SELECT candidate.id FROM public.fiscal_reauth_grants candidate
          WHERE candidate.expires_at<statement_timestamp()-interval '90 days'
            AND NOT EXISTS(SELECT 1 FROM public.efirma_sessions e WHERE e.grant_id=candidate.id)
          ORDER BY candidate.expires_at LIMIT 100);
        RETURN QUERY WITH candidates AS (SELECT e.id FROM public.efirma_sessions e
          WHERE e.cleanup_completed_at IS NULL
            AND (e.reconciled_at IS NULL OR e.reconciled_at<statement_timestamp()-interval '30 seconds')
          ORDER BY e.reconciled_at NULLS FIRST,e.id LIMIT 100 FOR UPDATE SKIP LOCKED)
        UPDATE public.efirma_sessions e SET reconciled_at=clock_timestamp() FROM candidates c WHERE e.id=c.id
        RETURNING e.id,e.organization_id;
      END $$`);
    await runner.query(`CREATE FUNCTION efirma_metadata_purge_batch() RETURNS TABLE(id uuid,organization_id uuid)
      LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
        SELECT e.id,e.organization_id FROM public.efirma_sessions e
        WHERE e.cleanup_completed_at IS NOT NULL AND e.terminal_at<statement_timestamp()-interval '90 days'
        ORDER BY e.terminal_at,e.id LIMIT 100
      $$;
      ALTER FUNCTION efirma_metadata_purge_batch() OWNER TO balanz_fiscal_reconcile_owner;
      REVOKE ALL ON FUNCTION efirma_metadata_purge_batch() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION efirma_metadata_purge_batch() TO balanz_worker`);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Forward-only custody reconciliation migration; use a reviewed corrective migration.',
      ),
    );
  }
}
