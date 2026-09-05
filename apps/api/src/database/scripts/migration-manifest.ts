/**
 * Canonical migration identities. PostgreSQL's ledger is validated by the
 * (name, timestamp) tuple; historical row order is deliberately not used as
 * authority because independently developed migrations can share a timestamp.
 */
export const EXPECTED_MIGRATION_IDENTITIES = [
  { name: 'Migration1787601284711', timestamp: 1787601284711 },
  { name: 'IdentityIntegrity1787690000000', timestamp: 1787690000000 },
  { name: 'AuthorizationModel1787690050000', timestamp: 1787690050000 },
  { name: 'ClientAccountsDomain1787690100000', timestamp: 1787690100000 },
  {
    name: 'ClientAccountSearchTrigram1787690200000',
    timestamp: 1787690200000,
  },
  { name: 'FiscalOperations1787690300000', timestamp: 1787690300000 },
  { name: 'PasswordResetTokens1787690300000', timestamp: 1787690300000 },
  { name: 'AuthDataCleanupIndexes1787690500000', timestamp: 1787690500000 },
  {
    name: 'FiscalIngestionFoundation1787690600000',
    timestamp: 1787690600000,
  },
  {
    name: 'SessionReauthentication1787690600000',
    timestamp: 1787690600000,
  },
  { name: 'FiscalRlsWorkerClaims1787690610000', timestamp: 1787690610000 },
  {
    name: 'IngestionAutomaticRetryBudget1787690620000',
    timestamp: 1787690620000,
  },
  {
    name: 'PhaseZeroRuntimeCompatibility1787690630000',
    timestamp: 1787690630000,
  },
  { name: 'PhaseOneCfdiDomain1787690700000', timestamp: 1787690700000 },
  {
    name: 'CfdiUsageCodeLength1787690710000',
    timestamp: 1787690710000,
  },
] as const;

export const EXPECTED_MIGRATION_NAMES: readonly string[] =
  EXPECTED_MIGRATION_IDENTITIES.map(({ name }) => name);

export const PHASE_ZERO_MIGRATION_NAMES = [
  'FiscalIngestionFoundation1787690600000',
  'FiscalRlsWorkerClaims1787690610000',
  'IngestionAutomaticRetryBudget1787690620000',
  'PhaseZeroRuntimeCompatibility1787690630000',
] as const;

export const ALLOWED_SHARED_MIGRATION_TIMESTAMPS = new Map<
  number,
  ReadonlySet<string>
>([
  [
    1787690300000,
    new Set([
      'FiscalOperations1787690300000',
      'PasswordResetTokens1787690300000',
    ]),
  ],
  [
    1787690600000,
    new Set([
      'FiscalIngestionFoundation1787690600000',
      'SessionReauthentication1787690600000',
    ]),
  ],
]);
