import { MigrationInterface, QueryRunner } from 'typeorm';

export class PasswordResetTokens1787690300000 implements MigrationInterface {
  name = 'PasswordResetTokens1787690300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "password_reset_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_password_reset_tokens" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_password_reset_tokens_hash" ON "password_reset_tokens" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_password_reset_tokens_user_expires" ON "password_reset_tokens" ("user_id", "expires_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "fk_password_reset_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "fk_password_reset_tokens_user"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_password_reset_tokens_user_expires"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_password_reset_tokens_hash"`,
    );
    await queryRunner.query(`DROP TABLE "password_reset_tokens"`);
  }
}
