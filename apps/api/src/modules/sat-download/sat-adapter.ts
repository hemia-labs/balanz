import { FiscalMetricsService } from '../../common/observability/fiscal-metrics.service';
import { parser } from 'sax';
import { Readable } from 'node:stream';
import { type KeyObject, X509Certificate } from 'node:crypto';
import {
  SOAP,
  SAT,
  AUTH,
  SOAP_ACTION,
  SatError,
  type SatOperation,
  type SatVerification,
} from './sat-contract';
import { signSatAuthentication, signSatOperation } from './sat-soap';
import { decodeSoapPackage } from './soap-package-stream';
export interface SatEndpoints {
  authentication: string;
  request: string;
  verification: string;
  download: string;
  isolated: boolean;
}
export const PRODUCTION_ENDPOINTS = {
  authentication:
    'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/Autenticacion/Autenticacion.svc',
  request:
    'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescargaService.svc',
  verification:
    'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/VerificaSolicitudDescargaService.svc',
  download:
    'https://cfdidescargamasiva.clouda.sat.gob.mx/DescargaMasivaService.svc',
};
/** Server configuration only; local transport cannot be enabled in managed runtimes. */
export class SatAdapter {
  constructor(
    private readonly endpoints: SatEndpoints,
    private readonly metrics?: FiscalMetricsService,
  ) {
    for (const [kind, value] of Object.entries(endpoints)) {
      if (kind === 'isolated') continue;
      const url = new URL(value as string);
      if (url.username || url.password || url.hash || url.search)
        throw new SatError('SAT_ENDPOINT_INVALID');
      if (endpoints.isolated) {
        if (
          process.env.NODE_ENV !== 'test' ||
          process.env.SAT_QA_ISOLATED !== 'true' ||
          !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
          !['http:', 'https:'].includes(url.protocol)
        )
          throw new SatError('SAT_ENDPOINT_INVALID');
      } else if (
        value !==
        PRODUCTION_ENDPOINTS[kind as keyof typeof PRODUCTION_ENDPOINTS]
      )
        throw new SatError('SAT_ENDPOINT_INVALID');
    }
  }
  private async post(
    kind: keyof typeof PRODUCTION_ENDPOINTS,
    op: SatOperation,
    body: string,
    signal: AbortSignal,
    token?: string,
  ) {
    if (
      token &&
      (!token.length ||
        token.length > 16384 ||
        /["\r\n]/.test(token) ||
        Array.from(token).some((c) => c.charCodeAt(0) < 32))
    )
      throw new SatError('SAT_TOKEN_INVALID');
    try {
      this.metrics?.increment('sat_external_calls_total', { operation: op });
      const response = await fetch(this.endpoints[kind], {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
        headers: {
          'Content-Type': 'text/xml;charset=UTF-8',
          SOAPAction: '"' + SOAP_ACTION[op] + '"',
          ...(token
            ? { Authorization: 'WRAP access_token="' + token + '"' }
            : {}),
        },
        body,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new SatError(
          [401, 403].includes(response.status)
            ? 'SAT_AUTH_REJECTED'
            : 'SAT_HTTP_ERROR',
          ![401, 403].includes(response.status),
        );
      }
      if (!response.body) throw new SatError('SAT_RESPONSE_MISSING', true);
      return response.body;
    } catch (error) {
      if (error instanceof SatError) throw error;
      throw new SatError('SAT_TRANSPORT_UNCERTAIN', true);
    }
  }
  async authenticate(
    key: KeyObject,
    cert: X509Certificate,
    expires: Date,
    signal: AbortSignal,
  ) {
    const now = new Date();
    const xml = signSatAuthentication(
      key,
      cert,
      now,
      new Date(Math.min(expires.getTime(), now.getTime() + 300000)),
    );
    const result = await smallReply(
      await this.post('authentication', 'Autentica', xml, signal),
      'Autentica',
      AUTH,
    );
    if (!result.text || result.text.length > 16384)
      throw new SatError('SAT_AUTH_INVALID');
    return result.text;
  }
  async submit(
    op:
      | 'SolicitaDescargaEmitidos'
      | 'SolicitaDescargaRecibidos'
      | 'SolicitaDescargaFolio',
    attributes: Record<string, string>,
    key: KeyObject,
    cert: X509Certificate,
    token: string,
    signal: AbortSignal,
  ) {
    return smallReply(
      await this.post(
        'request',
        op,
        signSatOperation(op, attributes, key, cert),
        signal,
        token,
      ),
      op,
      SAT,
    );
  }
  async verify(
    id: string,
    rfc: string,
    key: KeyObject,
    cert: X509Certificate,
    token: string,
    signal: AbortSignal,
  ): Promise<SatVerification> {
    const op = 'VerificaSolicitudDescarga';
    const r = await smallReply(
      await this.post(
        'verification',
        op,
        signSatOperation(
          op,
          { IdSolicitud: id, RfcSolicitante: rfc },
          key,
          cert,
        ),
        signal,
        token,
      ),
      op,
      SAT,
    );
    return {
      code: r.attributes.CodEstatus,
      state: Number(r.attributes.EstadoSolicitud),
      requestCode: r.attributes.CodigoEstadoSolicitud,
      count: Number(r.attributes.NumeroCFDIs),
      packages: r.packages,
    };
  }
  async download(
    id: string,
    rfc: string,
    key: KeyObject,
    cert: X509Certificate,
    token: string,
    signal: AbortSignal,
  ) {
    const op = 'PeticionDescargaMasivaTercerosEntrada';
    const stream = await this.post(
      'download',
      op,
      signSatOperation(op, { IdPaquete: id, RfcSolicitante: rfc }, key, cert),
      signal,
      token,
    );
    return Readable.from(decodeSoapPackage(stream));
  }
}
export async function smallReply(
  source: AsyncIterable<Uint8Array>,
  operation: string,
  namespace: string,
) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let xml = '',
    size = 0;
  for await (const part of source) {
    size += part.length;
    if (size > 1024 * 1024) throw new SatError('SAT_SOAP_LIMIT');
    xml += decoder.decode(part, { stream: true });
  }
  xml += decoder.decode();
  const p = parser(true, { xmlns: true, strictEntities: true });
  const stack: string[] = [],
    packages: string[] = [];
  let seen = false,
    text = '',
    attrs: Record<string, string> = {};
  const fail = () => {
    throw new SatError('SAT_SOAP_INVALID', true);
  };
  p.onerror = fail;
  p.ondoctype = fail;
  p.oncdata = fail;
  p.onopentag = (tag) => {
    const path = [...stack, tag.local].join('/');
    if (
      ![
        'Envelope',
        'Envelope/Header',
        'Envelope/Body',
        'Envelope/Body/' + operation + 'Response',
        'Envelope/Body/' + operation + 'Response/' + operation + 'Result',
        'Envelope/Body/' +
          operation +
          'Response/' +
          operation +
          'Result/IdsPaquetes',
      ].includes(path)
    )
      fail();
    if (
      tag.uri !==
      (['Envelope', 'Header', 'Body'].includes(tag.local) ? SOAP : namespace)
    )
      fail();
    if (tag.local === operation + 'Result') {
      if (seen) fail();
      seen = true;
      attrs = Object.fromEntries(
        Object.values(tag.attributes)
          .filter((x) => !x.uri)
          .map((x) => [x.local, x.value]),
      );
    }
    if (tag.local === 'IdsPaquetes') packages.push('');
    stack.push(tag.local);
  };
  p.onclosetag = () => {
    stack.pop();
  };
  p.ontext = (value) => {
    if (stack.at(-1) === 'IdsPaquetes') packages[packages.length - 1] += value;
    else if (operation === 'Autentica' && stack.at(-1) === 'AutenticaResult')
      text += value;
    else if (value.trim()) fail();
  };
  p.write(xml).close();
  if (
    !seen ||
    packages.length > 2000 ||
    packages.some((v) => !/^[-a-zA-Z0-9_]{1,128}$/.test(v))
  )
    fail();
  return { attributes: attrs, text, packages };
}
