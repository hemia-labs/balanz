import { efirmaConfiguration } from '../src/config/efirma.config';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readCustodyGeneration } from '../src/modules/efirma/custody-generation';

describe('custody activation and restore generation', () => {
  it('does not require Vault when disabled', () =>
    expect(efirmaConfiguration('api', {})).toMatchObject({ enabled: false }));
  it.each(['production', 'development'])(
    'cannot enable synthetic trust in %s',
    (NODE_ENV) => {
      expect(() =>
        efirmaConfiguration('api', {
          NODE_ENV,
          EFIRMA_ENABLED: 'true',
          EFIRMA_VAULT_ADDR: 'http://localhost:8200',
        }),
      ).toThrow();
    },
  );
  it('rejects a missing explicit QA opt-in', () =>
    expect(() =>
      efirmaConfiguration('api', {
        NODE_ENV: 'test',
        EFIRMA_ENABLED: 'true',
        EFIRMA_VAULT_ADDR: 'http://localhost:8200',
      }),
    ).toThrow());
  it('rereads the external generation and fails closed if missing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemia-generation-'));
    const path = join(directory, 'generation');
    try {
      const first = randomUUID();
      writeFileSync(path, first);
      expect(await readCustodyGeneration(path)).toBe(first);
      const second = randomUUID();
      writeFileSync(path, second);
      expect(await readCustodyGeneration(path)).toBe(second);
      writeFileSync(path, 'invalid');
      await expect(readCustodyGeneration(path)).rejects.toThrow(
        'EFIRMA_GENERATION_UNAVAILABLE',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    await expect(readCustodyGeneration(path)).rejects.toThrow(
      'EFIRMA_GENERATION_UNAVAILABLE',
    );
  });
});
