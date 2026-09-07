import { MigrationInterface, QueryRunner } from 'typeorm';

export class InvitationDeliveryStatus1787690820000 implements MigrationInterface {
  name = 'InvitationDeliveryStatus1787690820000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."invitations_delivery_status_enum" AS ENUM('pending', 'sent', 'failed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ADD "delivery_status" "public"."invitations_delivery_status_enum" NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `UPDATE "invitations" SET "delivery_status" = 'sent' WHERE "last_sent_at" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP COLUMN "delivery_status"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."invitations_delivery_status_enum"`,
    );
  }
}
