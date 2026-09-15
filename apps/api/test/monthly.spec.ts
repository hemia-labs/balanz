import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_DECISION,
  DEFAULT_CHECKLIST,
  MONTHLY_SCHEMA,
  DECISION_POLICY,
  decisionPermissions,
  validateDecision,
  monthlyChanges,
  type MonthlySnapshot,
  type Participation,
} from '../src/modules/client-accounts/monthly.contract';
import {
  BulkDto,
  DecisionDto,
  MonthlyQueryDto,
} from '../src/modules/client-accounts/monthly.dtos';
import {
  isPermissionKey,
  permissionDefinition,
} from '../src/common/auth/permission-catalog';
const row = (): Participation => ({
  ...DEFAULT_DECISION,
  id: randomUUID(),
  cfdiId: randomUUID(),
  uuid: randomUUID(),
  documentType: 'P',
  direction: 'received',
  issuerRfc: 'AAA010101AAA',
  issuerName: null,
  receiverRfc: 'BBB010101BBB',
  receiverName: null,
  sourceDate: '2026-02-01T05:30:00Z',
  literalDate: '2026-01-31T23:30:00',
  sourceOrdinal: 1,
  participationType: 'payment',
  policyVersion: 'cfdi-period-participation/1.0.0',
  timezone: 'America/Mexico_City',
  currency: 'XXX',
  total: '0',
  version: 0,
  decisionId: null,
  sourceObjectId: randomUUID(),
  sha256: 'a'.repeat(64),
  hasIncidents: false,
  satObservation: null,
  relations: [],
});
const snapshot = (participations: Participation[]): MonthlySnapshot => ({
  schemaVersion: MONTHLY_SCHEMA,
  decisionPolicy: DECISION_POLICY,
  periodId: randomUUID(),
  entityId: randomUUID(),
  year: 2026,
  month: 1,
  participations,
  incidents: [],
  sources: [],
  checklist: [],
  templateKeys: [...DEFAULT_CHECKLIST],
  scopeStatement: 'Revisión interna',
});
describe('monthly decisions and durable comparisons', () => {
  it('defaults independently to pending and included', () => {
    expect(DEFAULT_DECISION.reviewStatus).toBe('pending');
    expect(DEFAULT_DECISION.inclusion).toBe('included');
    expect(() => validateDecision({ ...DEFAULT_DECISION })).not.toThrow();
  });
  it('requires reasons only for explicit exclusions and documented treatments', () => {
    expect(() =>
      validateDecision({ ...DEFAULT_DECISION, inclusion: 'excluded' }),
    ).toThrow();
    expect(() =>
      validateDecision({ ...DEFAULT_DECISION, taxStatus: 'documentado' }),
    ).toThrow();
    expect(() =>
      validateDecision({ ...DEFAULT_DECISION, vatStatus: 'no_aplica' }),
    ).not.toThrow();
  });
  it('keeps classification and exclusion permissions distinct', () => {
    expect(
      decisionPermissions(DEFAULT_DECISION, {
        ...DEFAULT_DECISION,
        reviewStatus: 'reviewed',
      }),
    ).toEqual(['cfdi.review']);
    expect(
      decisionPermissions(DEFAULT_DECISION, {
        ...DEFAULT_DECISION,
        categoryId: randomUUID(),
      }),
    ).toContain('cfdi.classify');
    expect(
      decisionPermissions(DEFAULT_DECISION, {
        ...DEFAULT_DECISION,
        inclusion: 'excluded',
        exclusionReason: 'Fuera del alcance',
      }),
    ).toContain('cfdi.exclude');
  });
  it('detects arrivals by identity even when dates precede the close', () => {
    const first = row(),
      late = { ...row(), sourceDate: '2020-01-01T00:00:00Z' };
    const before = snapshot([first]),
      after = { ...before, participations: [late, first] };
    expect(monthlyChanges(before, after).added.map((x) => x.id)).toEqual([
      late.id,
    ]);
  });
  it('does not confuse two payment ordinals of one document', () => {
    const first = row(),
      second = { ...first, id: randomUUID(), sourceOrdinal: 2 };
    const before = snapshot([first, second]);
    const after = {
      ...before,
      participations: [
        first,
        { ...second, version: 1, reviewStatus: 'reviewed' as const },
      ],
    };
    expect(monthlyChanges(before, after).changed.map((x) => x.id)).toEqual([
      second.id,
    ]);
    expect(first.reviewStatus).toBe('pending');
  });
  it('detects a newly incorporated relation and an observed SAT state independently', () => {
    const first = row(),
      before = snapshot([first]);
    expect(
      monthlyChanges(before, {
        ...before,
        participations: [
          {
            ...first,
            relations: [
              {
                id: randomUUID(),
                uuid: randomUUID(),
                type: '01',
                incorporation: 'present',
              },
            ],
          },
        ],
      }).changed,
    ).toHaveLength(1);
    expect(
      monthlyChanges(before, {
        ...before,
        participations: [
          {
            ...first,
            satObservation: {
              id: randomUUID(),
              packageId: randomUUID(),
              status: 'cancelled',
              observedAt: '2026-09-15',
            },
          },
        ],
      }).changed,
    ).toHaveLength(1);
  });
  it('does not infer SAT status from an XML', () =>
    expect(row().satObservation).toBeNull());
  it('accepts only the new scoped category key, not arbitrary nested keys', () => {
    expect(isPermissionKey('cfdi.categories.manage')).toBe(true);
    expect(isPermissionKey('cfdi.any.manage')).toBe(false);
    expect(
      permissionDefinition('periods.takeover').requiresReauthentication,
    ).toBe(true);
  });
});
describe('monthly input boundaries', () => {
  const base = () => ({
    instanceToken: 'a'.repeat(64),
    expectedVersion: 0,
    action: 'review',
    selection: [{ id: randomUUID(), version: 0 }],
  });
  it('caps frozen selections at 100 and rejects duplicate identities', async () => {
    const input = base();
    expect(
      await validate(
        plainToInstance(BulkDto, {
          ...input,
          selection: Array.from({ length: 100 }, () => ({
            id: randomUUID(),
            version: 0,
          })),
        }),
      ),
    ).toHaveLength(0);
    expect(
      (
        await validate(
          plainToInstance(BulkDto, {
            ...input,
            selection: Array.from({ length: 101 }, () => ({
              id: randomUUID(),
              version: 0,
            })),
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(BulkDto, {
            ...input,
            selection: [input.selection[0], input.selection[0]],
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('rejects negative versions and oversized comments', async () => {
    const input = {
      ...base(),
      ...DEFAULT_DECISION,
      decisionVersion: -1,
      comment: 'x'.repeat(2001),
    };
    expect(
      (await validate(plainToInstance(DecisionDto, input))).length,
    ).toBeGreaterThan(0);
  });
  it('bounds pagination and preserves decimal query values as strings', async () => {
    const q = plainToInstance(MonthlyQueryDto, {
      page: '2',
      limit: '100',
      amountFrom: '9007199254740993.123456',
    });
    expect(await validate(q)).toHaveLength(0);
    expect(q.amountFrom).toBe('9007199254740993.123456');
    expect(
      (
        await validate(
          plainToInstance(MonthlyQueryDto, { dateFrom: '2026-02-30' }),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      await validate(
        plainToInstance(MonthlyQueryDto, { dateFrom: '2026-02-28' }),
      ),
    ).toHaveLength(0);
    expect(
      (await validate(plainToInstance(MonthlyQueryDto, { limit: '101' })))
        .length,
    ).toBeGreaterThan(0);
  });
});
