import { MigrationInterface, QueryRunner } from 'typeorm';

export class InvitationsLifecycle1787690800000 implements MigrationInterface {
  name = 'InvitationsLifecycle1787690800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE invitations_status_enum AS ENUM (
        'pending', 'accepted', 'expired', 'revoked'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE invitations (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id uuid NOT NULL,
        email varchar(320) NOT NULL,
        email_normalized varchar(320) NOT NULL,
        user_id uuid,
        role_id uuid NOT NULL,
        proposed_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
        token_hash varchar(64) NOT NULL,
        status invitations_status_enum NOT NULL DEFAULT 'pending',
        invited_by_membership_id uuid NOT NULL,
        accepted_membership_id uuid,
        expires_at timestamptz NOT NULL,
        last_sent_at timestamptz NOT NULL,
        send_count integer NOT NULL DEFAULT 1,
        accepted_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_invitations_organization
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_invitations_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_invitations_role
          FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT,
        CONSTRAINT fk_invitations_inviter_tenant
          FOREIGN KEY (organization_id, invited_by_membership_id)
          REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_invitations_accepted_membership_tenant
          FOREIGN KEY (organization_id, accepted_membership_id)
          REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_invitations_email_normalized
          CHECK (email_normalized = lower(btrim(email))),
        CONSTRAINT ck_invitations_send_count CHECK (send_count >= 1),
        CONSTRAINT ck_invitations_proposed_permissions_array
          CHECK (jsonb_typeof(proposed_permissions) = 'array'),
        CONSTRAINT ck_invitations_expiration CHECK (expires_at > created_at),
        CONSTRAINT ck_invitations_transition_dates CHECK (
          (status = 'pending' AND accepted_at IS NULL AND revoked_at IS NULL AND accepted_membership_id IS NULL)
          OR (status = 'accepted' AND accepted_at IS NOT NULL AND revoked_at IS NULL AND accepted_membership_id IS NOT NULL)
          OR (status = 'expired' AND accepted_at IS NULL AND revoked_at IS NULL AND accepted_membership_id IS NULL)
          OR (status = 'revoked' AND accepted_at IS NULL AND revoked_at IS NOT NULL AND accepted_membership_id IS NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_invitations_token_hash ON invitations(token_hash)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_invitations_pending_recipient
      ON invitations(organization_id, email_normalized)
      WHERE status = 'pending'
    `);
    await queryRunner.query(`
      CREATE INDEX ix_invitations_organization_status_expires
      ON invitations(organization_id, status, expires_at)
    `);
    await queryRunner.query(`
      ALTER TABLE memberships
      ADD CONSTRAINT ck_memberships_transition_dates CHECK (
        (status = 'pending' AND joined_at IS NULL AND suspended_at IS NULL AND revoked_at IS NULL)
        OR (status = 'active' AND joined_at IS NOT NULL AND suspended_at IS NULL AND revoked_at IS NULL)
        OR (status = 'suspended' AND joined_at IS NOT NULL AND suspended_at IS NOT NULL AND revoked_at IS NULL)
        OR (status = 'revoked' AND revoked_at IS NOT NULL)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE memberships DROP CONSTRAINT ck_memberships_transition_dates
    `);
    await queryRunner.query(
      `DROP INDEX ix_invitations_organization_status_expires`,
    );
    await queryRunner.query(`DROP INDEX uq_invitations_pending_recipient`);
    await queryRunner.query(`DROP INDEX uq_invitations_token_hash`);
    await queryRunner.query(`DROP TABLE invitations`);
    await queryRunner.query(`DROP TYPE invitations_status_enum`);
  }
}
