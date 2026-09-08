import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CFDI 4.0 c_UsoCFDI includes four-character values such as CP01. Phase 1's
 * original column was three characters wide, so valid payment complements
 * could not reach a terminal persisted result.
 */
export class CfdiUsageCodeLength1787690710000 implements MigrationInterface {
  name = 'CfdiUsageCodeLength1787690710000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL ROLE balanz_fiscal_owner`);
    try {
      await queryRunner.query(`
        ALTER TABLE cfdis
        ALTER COLUMN usage_code TYPE varchar(4)
      `);
    } finally {
      await queryRunner.query(`RESET ROLE`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL ROLE balanz_fiscal_owner`);
    try {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM cfdis WHERE char_length(usage_code) > 3
          ) THEN
            RAISE EXCEPTION
              'cfdi_usage_code_length: cannot narrow usage_code while four-character values exist';
          END IF;
        END $$
      `);
      await queryRunner.query(`
        ALTER TABLE cfdis
        ALTER COLUMN usage_code TYPE varchar(3)
      `);
    } finally {
      await queryRunner.query(`RESET ROLE`);
    }
  }
}
