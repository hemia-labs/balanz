import { MigrationInterface, QueryRunner } from 'typeorm';
import { PaymentsSchema1792886400000 } from '@hemia/payments/nestjs';

export class PaymentsInitial1792886500000 implements MigrationInterface {
  name = 'PaymentsInitial1792886500000';
  async up(runner: QueryRunner): Promise<void> {
    await new PaymentsSchema1792886400000().up(runner);
    await runner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='subscriptions_status_enum') THEN
          CREATE TYPE public.subscriptions_status_enum AS ENUM ('pending','trialing');
        END IF;
      END $$;
      CREATE TABLE IF NOT EXISTS public.subscriptions (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
        subscription_type varchar(100) NOT NULL,
        status public.subscriptions_status_enum NOT NULL,
        trial_started_at timestamptz, trial_ends_at timestamptz,
        created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT uq_subscriptions_organization_id UNIQUE(organization_id)
      );
      REVOKE ALL ON public.subscriptions FROM PUBLIC;
      GRANT SELECT,INSERT,UPDATE ON public.subscriptions TO balanz_api;
      REVOKE ALL ON public.payments_checkout_attempts,public.payments_licenses FROM PUBLIC;
      GRANT SELECT,INSERT,UPDATE ON public.payments_checkout_attempts TO balanz_api;
      GRANT SELECT ON public.payments_licenses TO balanz_api;
      GRANT SELECT,INSERT,UPDATE ON public.payments_checkout_attempts,public.payments_licenses TO balanz_fiscal_reconcile_owner;
      DO $$ BEGIN EXECUTE format('GRANT balanz_fiscal_reconcile_owner TO %I',current_user); END $$;
      GRANT USAGE,CREATE ON SCHEMA public TO balanz_fiscal_reconcile_owner;
      ALTER FUNCTION public.payments_apply_license(uuid,text,bigint,jsonb,jsonb) OWNER TO balanz_fiscal_reconcile_owner;
      REVOKE ALL ON FUNCTION public.payments_apply_license(uuid,text,bigint,jsonb,jsonb) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.payments_apply_license(uuid,text,bigint,jsonb,jsonb) TO balanz_api;
      REVOKE CREATE ON SCHEMA public FROM balanz_fiscal_reconcile_owner;
      DO $$ BEGIN EXECUTE format('REVOKE balanz_fiscal_reconcile_owner FROM %I',current_user); END $$;
    `);
    for (const table of ['payments_checkout_attempts', 'payments_licenses']) {
      await runner.query(`
        ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY payments_api_tenant ON public.${table} TO balanz_api
        USING (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND EXISTS (
          SELECT 1 FROM public.memberships m JOIN public.organizations o ON o.id=m.organization_id
          WHERE m.id=nullif(current_setting('app.membership_id',true),'')::uuid
          AND m.organization_id=${table}.organization_id AND m.status='active' AND o.status='active'))
        WITH CHECK (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid AND EXISTS (
          SELECT 1 FROM public.memberships m JOIN public.organizations o ON o.id=m.organization_id
          WHERE m.id=nullif(current_setting('app.membership_id',true),'')::uuid
          AND m.organization_id=${table}.organization_id AND m.status='active' AND o.status='active'));
      `);
    }
  }
  down(): Promise<void> {
    throw new Error(
      'Payments baseline cannot be reverted without losing payment data; restore an explicit backup.',
    );
  }
}
