import { MigrationInterface, QueryRunner } from 'typeorm';

export class SessionReauthentication1787690600000 implements MigrationInterface {
  name = 'SessionReauthentication1787690600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth_sessions
      ADD COLUMN reauthenticated_at timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth_sessions
      DROP COLUMN reauthenticated_at
    `);
  }
}
