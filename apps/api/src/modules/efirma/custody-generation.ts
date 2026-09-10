import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

/** Read on each operation: never cache a generation across an operator restore. */
export async function readCustodyGeneration(path: string): Promise<string> {
  try {
    if (!isAbsolute(path)) throw new Error();
    const value = (
      await readFile(path, { encoding: 'utf8', flag: 'r' })
    ).trim();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      throw new Error();
    return value.toLowerCase();
  } catch {
    throw new Error('EFIRMA_GENERATION_UNAVAILABLE');
  }
}
