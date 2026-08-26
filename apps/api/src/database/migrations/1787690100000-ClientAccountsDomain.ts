import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClientAccountsDomain1787690100000 implements MigrationInterface {
  name = 'ClientAccountsDomain1787690100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE client_accounts_status_enum AS ENUM ('active', 'suspended', 'archived')`,
    );
    await queryRunner.query(`
      CREATE TABLE client_accounts (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        name varchar(160) NOT NULL,
        code varchar(50),
        status client_accounts_status_enum NOT NULL DEFAULT 'active',
        version integer NOT NULL DEFAULT 1,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_client_accounts PRIMARY KEY (id),
        CONSTRAINT uq_client_accounts_org_id UNIQUE (organization_id, id),
        CONSTRAINT ck_client_accounts_name CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 160),
        CONSTRAINT ck_client_accounts_archive_state CHECK ((status = 'archived' AND archived_at IS NOT NULL) OR (status <> 'archived' AND archived_at IS NULL)),
        CONSTRAINT fk_client_accounts_organization FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_client_accounts_active_code ON client_accounts (organization_id, lower(btrim(code))) WHERE code IS NOT NULL AND archived_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_client_accounts_org_status_updated ON client_accounts (organization_id, status, updated_at, id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_client_accounts_name_search ON client_accounts (organization_id, lower(name))`,
    );

    await queryRunner.query(
      `CREATE TYPE legal_entities_status_enum AS ENUM ('active', 'suspended', 'archived')`,
    );
    await queryRunner.query(`
      CREATE TABLE legal_entities (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        rfc varchar(13) NOT NULL,
        legal_name varchar(200) NOT NULL,
        status legal_entities_status_enum NOT NULL DEFAULT 'active',
        version integer NOT NULL DEFAULT 1,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_legal_entities PRIMARY KEY (id),
        CONSTRAINT uq_legal_entities_org_id UNIQUE (organization_id, id),
        CONSTRAINT uq_legal_entities_account_id UNIQUE (organization_id, client_account_id, id),
        CONSTRAINT ck_legal_entities_rfc CHECK (rfc = upper(btrim(rfc)) AND char_length(rfc) IN (12, 13) AND rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
        CONSTRAINT ck_legal_entities_name CHECK (legal_name = btrim(legal_name) AND char_length(legal_name) BETWEEN 1 AND 200),
        CONSTRAINT ck_legal_entities_archive_state CHECK ((status = 'archived' AND archived_at IS NOT NULL) OR (status <> 'archived' AND archived_at IS NULL)),
        CONSTRAINT fk_legal_entities_account FOREIGN KEY (organization_id, client_account_id) REFERENCES client_accounts(organization_id, id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_legal_entities_active_rfc ON legal_entities (organization_id, rfc) WHERE archived_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_legal_entities_account_status ON legal_entities (organization_id, client_account_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_legal_entities_org_rfc ON legal_entities (organization_id, rfc)`,
    );

    await queryRunner.query(
      `CREATE TYPE account_assignments_responsibility_enum AS ENUM ('primary', 'collaborator', 'reviewer')`,
    );
    await queryRunner.query(
      `CREATE TYPE account_assignments_status_enum AS ENUM ('active', 'revoked')`,
    );
    await queryRunner.query(`
      CREATE TABLE account_assignments (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        membership_id uuid NOT NULL,
        responsibility account_assignments_responsibility_enum NOT NULL,
        status account_assignments_status_enum NOT NULL DEFAULT 'active',
        assigned_by_membership_id uuid NOT NULL,
        assigned_at timestamptz NOT NULL,
        revoked_by_membership_id uuid,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_account_assignments PRIMARY KEY (id),
        CONSTRAINT ck_account_assignments_revoke_state CHECK ((status = 'active' AND revoked_at IS NULL AND revoked_by_membership_id IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_membership_id IS NOT NULL)),
        CONSTRAINT fk_account_assignments_account FOREIGN KEY (organization_id, client_account_id) REFERENCES client_accounts(organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_account_assignments_membership FOREIGN KEY (organization_id, membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_account_assignments_assigned_by FOREIGN KEY (organization_id, assigned_by_membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_account_assignments_revoked_by FOREIGN KEY (organization_id, revoked_by_membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_account_assignments_active_member ON account_assignments (organization_id, client_account_id, membership_id) WHERE status = 'active'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_account_assignments_active_primary ON account_assignments (organization_id, client_account_id) WHERE status = 'active' AND responsibility = 'primary'`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_account_assignments_membership_status ON account_assignments (organization_id, membership_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_account_assignments_account_status ON account_assignments (organization_id, client_account_id, status)`,
    );

    await queryRunner.query(
      `CREATE TYPE fiscal_years_status_enum AS ENUM ('active', 'closed', 'archived')`,
    );
    await queryRunner.query(`
      CREATE TABLE fiscal_years (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        year smallint NOT NULL,
        status fiscal_years_status_enum NOT NULL DEFAULT 'active',
        version integer NOT NULL DEFAULT 1,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_fiscal_years PRIMARY KEY (id),
        CONSTRAINT uq_fiscal_years_org_id UNIQUE (organization_id, id),
        CONSTRAINT uq_fiscal_years_chain_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT uq_fiscal_years_entity_year UNIQUE (organization_id, legal_entity_id, year),
        CONSTRAINT ck_fiscal_years_year CHECK (year BETWEEN 2000 AND 2200),
        CONSTRAINT ck_fiscal_years_archive_state CHECK ((status = 'archived' AND archived_at IS NOT NULL) OR (status <> 'archived' AND archived_at IS NULL)),
        CONSTRAINT fk_fiscal_years_legal_entity FOREIGN KEY (organization_id, client_account_id, legal_entity_id) REFERENCES legal_entities(organization_id, client_account_id, id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_fiscal_years_entity_year_status ON fiscal_years (organization_id, legal_entity_id, year, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_fiscal_years_account_year ON fiscal_years (organization_id, client_account_id, year)`,
    );

    await queryRunner.query(
      `CREATE TYPE periods_status_enum AS ENUM ('not_started', 'preparation', 'review', 'ready_to_close', 'closed', 'changes_detected', 'reopened', 'blocked')`,
    );
    await queryRunner.query(`
      CREATE TABLE periods (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        fiscal_year_id uuid NOT NULL,
        month smallint NOT NULL,
        status periods_status_enum NOT NULL DEFAULT 'not_started',
        cutoff_at timestamptz,
        lock_version integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_periods PRIMARY KEY (id),
        CONSTRAINT uq_periods_org_id UNIQUE (organization_id, id),
        CONSTRAINT uq_periods_year_month UNIQUE (organization_id, fiscal_year_id, month),
        CONSTRAINT ck_periods_month CHECK (month BETWEEN 1 AND 12),
        CONSTRAINT fk_periods_fiscal_year FOREIGN KEY (organization_id, client_account_id, legal_entity_id, fiscal_year_id) REFERENCES fiscal_years(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_periods_year_month ON periods (organization_id, fiscal_year_id, month)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_periods_org_status ON periods (organization_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_periods_legal_entity ON periods (organization_id, legal_entity_id, fiscal_year_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE periods`);
    await queryRunner.query(`DROP TYPE periods_status_enum`);
    await queryRunner.query(`DROP TABLE fiscal_years`);
    await queryRunner.query(`DROP TYPE fiscal_years_status_enum`);
    await queryRunner.query(`DROP TABLE account_assignments`);
    await queryRunner.query(`DROP TYPE account_assignments_status_enum`);
    await queryRunner.query(
      `DROP TYPE account_assignments_responsibility_enum`,
    );
    await queryRunner.query(`DROP TABLE legal_entities`);
    await queryRunner.query(`DROP TYPE legal_entities_status_enum`);
    await queryRunner.query(`DROP TABLE client_accounts`);
    await queryRunner.query(`DROP TYPE client_accounts_status_enum`);
  }
}
