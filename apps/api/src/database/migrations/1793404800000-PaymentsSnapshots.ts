import { MigrationInterface, QueryRunner } from 'typeorm';
export class PaymentsSnapshots1793404800000 implements MigrationInterface {
  name = 'PaymentsSnapshots1793404800000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE public.payments_licenses ADD COLUMN subscription jsonb,
        ADD COLUMN snapshot_version smallint NOT NULL DEFAULT 0 CHECK(snapshot_version IN (0,1));
      CREATE FUNCTION public.payments_apply_snapshot(org uuid,product text,revision bigint,confirmed timestamptz,license jsonb,subscription jsonb)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      BEGIN
        IF org IS NULL OR product IS NULL OR length(product)<1 OR revision IS NULL OR revision<=0
          OR confirmed IS NULL OR confirmed>clock_timestamp()+interval '5 minutes'
          OR jsonb_typeof(license) IS DISTINCT FROM 'object' OR license->>'productCode' IS DISTINCT FROM product
          OR jsonb_typeof(license->'active') IS DISTINCT FROM 'boolean' THEN
          RAISE EXCEPTION 'invalid payments snapshot';
        END IF;
        IF subscription IS NOT NULL AND subscription<>'null'::jsonb AND (
          jsonb_typeof(subscription) IS DISTINCT FROM 'object'
          OR (subscription->>'organizationId')::uuid IS DISTINCT FROM org
          OR subscription->>'productCode' IS DISTINCT FROM product) THEN
          RAISE EXCEPTION 'invalid subscription scope';
        END IF;
        IF license->>'active'='true' AND (
          subscription IS NULL OR subscription='null'::jsonb
          OR subscription->>'id' IS NULL OR subscription->>'planCode' IS NULL
          OR subscription->>'id' IS DISTINCT FROM license->>'subscriptionId'
          OR subscription->>'planCode' IS DISTINCT FROM license->>'planCode') THEN
          RAISE EXCEPTION 'active license requires matching subscription';
        END IF;
        INSERT INTO public.payments_licenses(organization_id,product_code,revision,license,subscription,snapshot_version,confirmed_at,received_at,updated_at)
        VALUES(org,product,revision,license,NULLIF(subscription,'null'::jsonb),1,confirmed,clock_timestamp(),clock_timestamp())
        ON CONFLICT(organization_id,product_code) DO UPDATE SET revision=EXCLUDED.revision,license=EXCLUDED.license,
          subscription=EXCLUDED.subscription,snapshot_version=1,confirmed_at=EXCLUDED.confirmed_at,
          received_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE payments_licenses.revision<EXCLUDED.revision;
        RETURN FOUND;
      END $$;
      REVOKE ALL ON FUNCTION public.payments_apply_snapshot(uuid,text,bigint,timestamptz,jsonb,jsonb) FROM PUBLIC;
      DO $$ BEGIN EXECUTE format('GRANT balanz_fiscal_reconcile_owner TO %I',current_user); END $$;
      GRANT USAGE,CREATE ON SCHEMA public TO balanz_fiscal_reconcile_owner;
      ALTER FUNCTION public.payments_apply_snapshot(uuid,text,bigint,timestamptz,jsonb,jsonb) OWNER TO balanz_fiscal_reconcile_owner;
      GRANT EXECUTE ON FUNCTION public.payments_apply_snapshot(uuid,text,bigint,timestamptz,jsonb,jsonb) TO balanz_api;
      REVOKE CREATE ON SCHEMA public FROM balanz_fiscal_reconcile_owner;
      DO $$ BEGIN EXECUTE format('REVOKE balanz_fiscal_reconcile_owner FROM %I',current_user); END $$;
    `);
  }
  down(): Promise<void> {
    throw new Error(
      'Snapshot history cannot be reverted without losing synchronization evidence; restore an explicit backup.',
    );
  }
}
