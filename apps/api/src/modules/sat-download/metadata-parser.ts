import { createHash } from 'node:crypto';
import { SatError } from './sat-contract';
export const METADATA_HEADER = [
  'Uuid',
  'RfcEmisor',
  'NombreEmisor',
  'RfcReceptor',
  'NombreReceptor',
  'RfcPac',
  'FechaEmision',
  'FechaCertificacionSat',
  'Monto',
  'EfectoComprobante',
  'Estatus',
  'FechaCancelacion',
] as const;
export const METADATA_LIMITS = Object.freeze({
  rows: 100000,
  lineBytes: 8192,
  fieldChars: 1024,
});
export interface MetadataRow {
  uuid: string;
  issuer: string;
  receiver: string;
  issuedAt: string;
  certifiedAt: string;
  total: string;
  effect: string;
  status: 'active' | 'cancelled';
  cancelledAt: string | null;
  sha256: string;
}
const rfc = /^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$/;
function date(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value.replace(' ', 'T') + 'Z')) ||
    new Date(value.replace(' ', 'T') + 'Z').toISOString().slice(0, 19) !==
      value.replace(' ', 'T')
  )
    throw new SatError('SAT_METADATA_INVALID');
  return value.replace(' ', 'T');
}
export async function* parseMetadata(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<MetadataRow> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '',
    header = false,
    rows = 0;
  function parse(line: string): MetadataRow | undefined {
    if (!header) {
      header = true;
      if (line.replace(/^\uFEFF/, '') !== METADATA_HEADER.join('~'))
        throw new SatError('SAT_METADATA_HEADER_UNSUPPORTED');
      return;
    }
    if (!line) return;
    if (++rows > METADATA_LIMITS.rows) throw new SatError('SAT_METADATA_LIMIT');
    const f = line.split('~');
    if (
      f.length !== 12 ||
      f.some((v) => v.length > METADATA_LIMITS.fieldChars) ||
      !/^[-0-9a-f]{36}$/i.test(f[0]) ||
      !/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(f[0]) ||
      !rfc.test(f[1]) ||
      !rfc.test(f[3]) ||
      !/^\d{1,18}(?:\.\d{1,6})?$/.test(f[8]) ||
      !['I', 'E', 'T', 'N', 'P'].includes(f[9]) ||
      !['0', '1'].includes(f[10])
    )
      throw new SatError('SAT_METADATA_INVALID');
    return {
      uuid: f[0].toUpperCase(),
      issuer: f[1],
      receiver: f[3],
      issuedAt: date(f[6]),
      certifiedAt: date(f[7]),
      total: f[8],
      effect: f[9],
      status: f[10] === '1' ? 'active' : 'cancelled',
      cancelledAt: f[11] ? date(f[11]) : null,
      sha256: createHash('sha256').update(line).digest('hex'),
    };
  }
  for await (const chunk of source) {
    for (let i = 0; i < chunk.length; i += 4096) {
      pending += decoder.decode(chunk.subarray(i, i + 4096), { stream: true });
      let nl: number;
      while ((nl = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, nl).replace(/\r$/, '');
        pending = pending.slice(nl + 1);
        if (Buffer.byteLength(line) > METADATA_LIMITS.lineBytes)
          throw new SatError('SAT_METADATA_LIMIT');
        const row = parse(line);
        if (row) yield row;
      }
      if (Buffer.byteLength(pending) > METADATA_LIMITS.lineBytes)
        throw new SatError('SAT_METADATA_LIMIT');
    }
  }
  pending += decoder.decode();
  if (pending) {
    const row = parse(pending.replace(/\r$/, ''));
    if (row) yield row;
  }
  if (!header) throw new SatError('SAT_METADATA_HEADER_UNSUPPORTED');
}
