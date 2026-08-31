import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthDataCleanupIndexes1787690500000 implements MigrationInterface {
  name = 'AuthDataCleanupIndexes1787690500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_password_reset_tokens_expires_at" ON "password_reset_tokens" ("expires_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_password_reset_tokens_used_at" ON "password_reset_tokens" ("used_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_password_reset_tokens_used_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_password_reset_tokens_expires_at"`,
    );
  }
}
