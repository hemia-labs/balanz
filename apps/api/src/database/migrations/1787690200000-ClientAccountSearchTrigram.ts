import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClientAccountSearchTrigram1787690200000 implements MigrationInterface {
  name = 'ClientAccountSearchTrigram1787690200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(
      `CREATE INDEX ix_client_accounts_name_trgm ON client_accounts USING GIN (lower(name) gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_client_accounts_code_trgm ON client_accounts USING GIN (lower(code) gin_trgm_ops) WHERE code IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX ix_client_accounts_code_trgm`);
    await queryRunner.query(`DROP INDEX ix_client_accounts_name_trgm`);
  }
}
