import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Completes the Phase 0 runtime ACL after migrations added on develop and
 * narrows the bootstrap application grants to the operations used at runtime.
 */
export class PhaseZeroRuntimeCompatibility1787690630000 implements MigrationInterface {
  name = 'PhaseZeroRuntimeCompatibility1787690630000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Replace the broad bootstrap ACL from 061 with the operations exercised
    // by the API. None of these application workflows physically deletes a
    // row; lifecycle transitions are updates and maintenance uses a separate
    // operational credential.
    await queryRunner.query(`
      REVOKE ALL PRIVILEGES
      ON TABLE
        auth_factors,
        auth_rate_limits,
        email_verification_tokens,
        roles,
        memberships,
        organizations,
        permissions,
        role_permissions,
        auth_sessions,
        subscriptions,
        users,
        client_accounts,
        legal_entities,
        account_assignments,
        fiscal_years,
        periods,
        password_reset_tokens,
        membership_permissions,
        fiscal_operations,
        object_access_grants,
        private_objects
      FROM balanz_api
    `);
    await queryRunner.query(`
      REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
      FROM balanz_api
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE
      ON TABLE
        auth_factors,
        auth_rate_limits,
        email_verification_tokens,
        memberships,
        auth_sessions,
        subscriptions,
        users,
        client_accounts,
        legal_entities,
        account_assignments,
        periods,
        password_reset_tokens,
        membership_permissions,
        fiscal_operations,
        object_access_grants
      TO balanz_api
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT
      ON TABLE organizations, fiscal_years
      TO balanz_api
    `);
    await queryRunner.query(`
      GRANT SELECT
      ON TABLE roles, permissions, role_permissions, private_objects
      TO balanz_api
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      REVOKE ALL PRIVILEGES
      ON TABLE
        auth_factors,
        auth_rate_limits,
        email_verification_tokens,
        roles,
        memberships,
        organizations,
        permissions,
        role_permissions,
        auth_sessions,
        subscriptions,
        users,
        client_accounts,
        legal_entities,
        account_assignments,
        fiscal_years,
        periods,
        password_reset_tokens,
        membership_permissions,
        fiscal_operations,
        object_access_grants,
        private_objects
      FROM balanz_api
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE
        auth_factors,
        auth_rate_limits,
        email_verification_tokens,
        roles,
        memberships,
        organizations,
        permissions,
        role_permissions,
        auth_sessions,
        subscriptions,
        users,
        client_accounts,
        legal_entities,
        account_assignments,
        fiscal_years,
        periods
      TO balanz_api
    `);
    await queryRunner.query(`
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
      TO balanz_api
    `);
  }
}
