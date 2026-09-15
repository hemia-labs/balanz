export const SOAP = 'http://schemas.xmlsoap.org/soap/envelope/';
export const SAT = 'http://DescargaMasivaTerceros.sat.gob.mx';
export const AUTH = 'http://DescargaMasivaTerceros.gob.mx';
export const SAT_PACKAGE_LIMITS = Object.freeze({
  profile: 'sat_package_v1',
  compressed: 50 * 1024 * 1024,
  uncompressed: 250 * 1024 * 1024,
  entries: 2000,
  ratio: 50,
  depth: 2,
  path: 240,
  xml: 5 * 1024 * 1024,
  headers: 6000,
});
export const SAT_DOWNLOAD_ATTEMPTS = 2;
export type SatOperation =
  | 'Autentica'
  | 'SolicitaDescargaEmitidos'
  | 'SolicitaDescargaRecibidos'
  | 'SolicitaDescargaFolio'
  | 'VerificaSolicitudDescarga'
  | 'PeticionDescargaMasivaTercerosEntrada';
export const SOAP_ACTION: Record<SatOperation, string> = {
  Autentica: AUTH + '/IAutenticacion/Autentica',
  SolicitaDescargaEmitidos:
    SAT + '/ISolicitaDescargaService/SolicitaDescargaEmitidos',
  SolicitaDescargaRecibidos:
    SAT + '/ISolicitaDescargaService/SolicitaDescargaRecibidos',
  SolicitaDescargaFolio:
    SAT + '/ISolicitaDescargaService/SolicitaDescargaFolio',
  VerificaSolicitudDescarga:
    SAT + '/IVerificaSolicitudDescargaService/VerificaSolicitudDescarga',
  PeticionDescargaMasivaTercerosEntrada:
    SAT + '/IDescargaMasivaTercerosService/Descargar',
};
export class SatError extends Error {
  constructor(
    readonly code: string,
    readonly uncertain = false,
  ) {
    super(code);
  }
}
export interface SatVerification {
  code: string;
  state: number;
  requestCode: string;
  count: number;
  packages: string[];
}
export function classifyVerification(
  v: SatVerification,
): 'waiting' | 'packages' | 'empty' | 'failed' | 'contradictory' {
  if (v.code !== '5000') return 'failed';
  if (
    !Number.isSafeInteger(v.count) ||
    v.count < 0 ||
    new Set(v.packages).size !== v.packages.length
  )
    return 'contradictory';
  if ([1, 2].includes(v.state))
    return v.packages.length ? 'contradictory' : 'waiting';
  if (v.state !== 3)
    return [4, 5, 6].includes(v.state) ? 'failed' : 'contradictory';
  if (v.requestCode !== '5000') return 'contradictory';
  if (v.packages.length) return v.count === 0 ? 'contradictory' : 'packages';
  return v.count === 0 ? 'empty' : 'contradictory';
}
