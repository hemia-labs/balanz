import { MigrationInterface, QueryRunner } from 'typeorm';

export class IdentityIntegrity1787690000000 implements MigrationInterface {
  name = 'IdentityIntegrity1787690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM organizations o LEFT JOIN users u ON u.id = o.owner_user_id WHERE u.id IS NULL) THEN
          RAISE EXCEPTION 'identity_integrity: organizations.owner_user_id contains orphans';
        END IF;
        IF EXISTS (SELECT 1 FROM memberships m LEFT JOIN organizations o ON o.id = m.organization_id WHERE o.id IS NULL) THEN
          RAISE EXCEPTION 'identity_integrity: memberships.organization_id contains orphans';
        END IF;
        IF EXISTS (SELECT 1 FROM memberships m LEFT JOIN users u ON u.id = m.user_id WHERE u.id IS NULL) THEN
          RAISE EXCEPTION 'identity_integrity: memberships.user_id contains orphans';
        END IF;
        IF EXISTS (SELECT 1 FROM auth_sessions s LEFT JOIN users u ON u.id = s.user_id WHERE u.id IS NULL) THEN
          RAISE EXCEPTION 'identity_integrity: auth_sessions.user_id contains orphans';
        END IF;
        IF EXISTS (SELECT 1 FROM auth_sessions s WHERE (s.organization_id IS NULL) <> (s.membership_id IS NULL)) THEN
          RAISE EXCEPTION 'identity_integrity: auth session tenant context is incomplete';
        END IF;
        IF EXISTS (SELECT 1 FROM auth_sessions s LEFT JOIN memberships m ON m.organization_id = s.organization_id AND m.id = s.membership_id WHERE s.membership_id IS NOT NULL AND m.id IS NULL) THEN
          RAISE EXCEPTION 'identity_integrity: auth session membership tenant mismatch';
        END IF;
        IF EXISTS (SELECT 1 FROM auth_sessions s JOIN memberships m ON m.organization_id = s.organization_id AND m.id = s.membership_id WHERE s.user_id <> m.user_id) THEN
          RAISE EXCEPTION 'identity_integrity: auth session membership identity mismatch';
        END IF;
        IF EXISTS (SELECT 1 FROM auth_factors f LEFT JOIN users u ON u.id = f.user_id WHERE u.id IS NULL) THEN
          RAISE EXCEPTION 'identity_integrity: auth_factors.user_id contains orphans';
        END IF;
        IF EXISTS (SELECT 1 FROM email_verification_tokens t LEFT JOIN users u ON u.id = t.user_id WHERE u.id IS NULL) THEN
          RAISE EXCEPTION 'identity_integrity: email_verification_tokens.user_id contains orphans';
        END IF;
        IF EXISTS (SELECT 1 FROM subscriptions s LEFT JOIN organizations o ON o.id = s.organization_id WHERE o.id IS NULL) THEN
          RAISE EXCEPTION 'identity_integrity: subscriptions.organization_id contains orphans';
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE memberships ADD CONSTRAINT uq_memberships_organization_id UNIQUE (organization_id, id)`,
    );
    await queryRunner.query(
      `ALTER TABLE memberships ADD CONSTRAINT uq_memberships_organization_id_user UNIQUE (organization_id, id, user_id)`,
    );
    await queryRunner.query(
      `ALTER TABLE organizations ADD CONSTRAINT fk_organizations_owner_user FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE memberships ADD CONSTRAINT fk_memberships_organization FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE memberships ADD CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE auth_sessions ADD CONSTRAINT ck_auth_sessions_tenant_context CHECK ((organization_id IS NULL AND membership_id IS NULL) OR (organization_id IS NOT NULL AND membership_id IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE auth_sessions ADD CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE auth_sessions ADD CONSTRAINT fk_auth_sessions_membership_tenant FOREIGN KEY (organization_id, membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE auth_sessions ADD CONSTRAINT fk_auth_sessions_membership_identity FOREIGN KEY (organization_id, membership_id, user_id) REFERENCES memberships(organization_id, id, user_id) ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE auth_factors ADD CONSTRAINT fk_auth_factors_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE email_verification_tokens ADD CONSTRAINT fk_email_verification_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE subscriptions ADD CONSTRAINT fk_subscriptions_organization FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE subscriptions DROP CONSTRAINT fk_subscriptions_organization`,
    );
    await queryRunner.query(
      `ALTER TABLE email_verification_tokens DROP CONSTRAINT fk_email_verification_tokens_user`,
    );
    await queryRunner.query(
      `ALTER TABLE auth_factors DROP CONSTRAINT fk_auth_factors_user`,
    );
    await queryRunner.query(
      `ALTER TABLE auth_sessions DROP CONSTRAINT fk_auth_sessions_membership_tenant`,
    );
    await queryRunner.query(
      `ALTER TABLE auth_sessions DROP CONSTRAINT fk_auth_sessions_membership_identity`,
    );
    await queryRunner.query(
      `ALTER TABLE auth_sessions DROP CONSTRAINT fk_auth_sessions_user`,
    );
    await queryRunner.query(
      `ALTER TABLE auth_sessions DROP CONSTRAINT ck_auth_sessions_tenant_context`,
    );
    await queryRunner.query(
      `ALTER TABLE memberships DROP CONSTRAINT fk_memberships_user`,
    );
    await queryRunner.query(
      `ALTER TABLE memberships DROP CONSTRAINT fk_memberships_organization`,
    );
    await queryRunner.query(
      `ALTER TABLE organizations DROP CONSTRAINT fk_organizations_owner_user`,
    );
    await queryRunner.query(
      `ALTER TABLE memberships DROP CONSTRAINT uq_memberships_organization_id`,
    );
    await queryRunner.query(
      `ALTER TABLE memberships DROP CONSTRAINT uq_memberships_organization_id_user`,
    );
  }
}
