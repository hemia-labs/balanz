import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PERMISSION_CATALOG } from '../src/common/auth/permission-catalog';

describe('frontend/backend permission catalog contract', () => {
  it('keeps the frontend capability keys identical to the backend catalog', () => {
    const source = readFileSync(
      resolve(__dirname, '../../web/src/lib/accounting-types.ts'),
      'utf8',
    );
    const declaration = source.match(
      /export const capabilities = \[([\s\S]*?)\] as const;/,
    );
    expect(declaration).not.toBeNull();

    const frontendKeys = Array.from(
      declaration![1].matchAll(/["']([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)["']/g),
      (match) => match[1],
    );

    expect(frontendKeys).toEqual([...PERMISSION_CATALOG]);
  });
});
