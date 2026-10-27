import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeEmailVerificationTokens1787690810000 implements MigrationInterface {
  name = 'ScopeEmailVerificationTokens1787690810000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE email_verification_tokens
      ADD COLUMN membership_id uuid
    `);
    await queryRunner.query(`
      ALTER TABLE email_verification_tokens
      ADD CONSTRAINT fk_email_verification_tokens_membership
      FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX idx_email_verification_tokens_membership_expires
      ON email_verification_tokens(membership_id, expires_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX idx_email_verification_tokens_membership_expires`,
    );
    await queryRunner.query(`
      ALTER TABLE email_verification_tokens
      DROP CONSTRAINT fk_email_verification_tokens_membership
    `);
    await queryRunner.query(`
      ALTER TABLE email_verification_tokens
      DROP COLUMN membership_id
    `);
  }
}
