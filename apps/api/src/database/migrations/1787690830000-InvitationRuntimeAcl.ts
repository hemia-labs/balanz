import { MigrationInterface, QueryRunner } from 'typeorm';

export class InvitationRuntimeAcl1787690830000 implements MigrationInterface {
  name = 'InvitationRuntimeAcl1787690830000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE
      ON TABLE invitations
      TO balanz_api
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      REVOKE SELECT, INSERT, UPDATE
      ON TABLE invitations
      FROM balanz_api
    `);
  }
}
