import { MigrationInterface, QueryRunner } from 'typeorm';

export class FiscalOperations1787690300000 implements MigrationInterface {
  name = 'FiscalOperations1787690300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE private_objects (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        permission_key varchar(80) NOT NULL,
        storage_key varchar(1000) NOT NULL,
        status varchar(20) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT private_objects_pkey PRIMARY KEY (id),
        CONSTRAINT private_objects_status_chk CHECK (status IN ('available', 'revoked')),
        CONSTRAINT fk_private_objects_account
          FOREIGN KEY (organization_id, client_account_id)
          REFERENCES client_accounts(organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_private_objects_permission
          FOREIGN KEY (permission_key) REFERENCES permissions(key) ON DELETE RESTRICT
      );
      CREATE INDEX ix_private_objects_org_account
        ON private_objects(organization_id, client_account_id);

      CREATE TABLE object_access_grants (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        object_id uuid NOT NULL,
        organization_id uuid NOT NULL,
        membership_id uuid NOT NULL,
        session_id uuid NOT NULL,
        token_hash char(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT object_access_grants_pkey PRIMARY KEY (id),
        CONSTRAINT fk_object_access_grants_object
          FOREIGN KEY (object_id) REFERENCES private_objects(id) ON DELETE CASCADE,
        CONSTRAINT fk_object_access_grants_session
          FOREIGN KEY (session_id) REFERENCES auth_sessions(id) ON DELETE CASCADE,
        CONSTRAINT fk_object_access_grants_membership
          FOREIGN KEY (organization_id, membership_id)
          REFERENCES memberships(organization_id, id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX uq_object_access_grants_token_hash
        ON object_access_grants(token_hash);
      CREATE INDEX ix_object_access_grants_expiry
        ON object_access_grants(expires_at, used_at);

      CREATE TABLE fiscal_operations (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        requested_by_membership_id uuid NOT NULL,
        source_session_id uuid NOT NULL,
        type varchar(24) NOT NULL,
        status varchar(20) NOT NULL,
        request jsonb NOT NULL DEFAULT '{}',
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fiscal_operations_pkey PRIMARY KEY (id),
        CONSTRAINT fiscal_operations_type_chk
          CHECK (type IN ('sat_download', 'export')),
        CONSTRAINT fiscal_operations_status_chk
          CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'expired')),
        CONSTRAINT fk_fiscal_operations_account
          FOREIGN KEY (organization_id, client_account_id)
          REFERENCES client_accounts(organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_fiscal_operations_membership
          FOREIGN KEY (organization_id, requested_by_membership_id)
          REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_fiscal_operations_session
          FOREIGN KEY (source_session_id)
          REFERENCES auth_sessions(id) ON DELETE RESTRICT
      );
      CREATE INDEX ix_fiscal_operations_status_expiry
        ON fiscal_operations(status, expires_at);
      CREATE INDEX ix_fiscal_operations_org_account
        ON fiscal_operations(organization_id, client_account_id, created_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE fiscal_operations;
      DROP TABLE object_access_grants;
      DROP TABLE private_objects;
    `);
  }
}
