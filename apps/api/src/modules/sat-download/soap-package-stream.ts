import { parser } from 'sax';
import { TextDecoder } from 'node:util';
import { SOAP, SAT, SAT_PACKAGE_LIMITS, SatError } from './sat-contract';
/** Incremental strict base64. Only one quantum is retained between parser callbacks. */
export class Base64Decoder {
  private tail = '';
  private ended = false;
  private bytes = 0;
  write(text: string): Buffer {
    const clean = text.replace(/[\t\r\n ]/g, '');
    if (/[^A-Za-z0-9+/=]/.test(clean) || (this.ended && clean))
      throw new SatError('SAT_BASE64_INVALID');
    this.tail += clean;
    const n = this.tail.length - (this.tail.length % 4);
    const complete = this.tail.slice(0, n);
    this.tail = this.tail.slice(n);
    if (!complete) return Buffer.alloc(0);
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        complete,
      )
    )
      throw new SatError('SAT_BASE64_INVALID');
    const decoded = Buffer.from(complete, 'base64');
    if (decoded.toString('base64') !== complete)
      throw new SatError('SAT_BASE64_INVALID');
    this.ended = complete.includes('=');
    if (this.ended && this.tail) throw new SatError('SAT_BASE64_INVALID');
    this.bytes += decoded.length;
    if (this.bytes > SAT_PACKAGE_LIMITS.compressed)
      throw new SatError('SAT_PACKAGE_LIMIT');
    return decoded;
  }
  finish() {
    if (this.tail || !this.bytes) throw new SatError('SAT_BASE64_INVALID');
  }
}
export async function* decodeSoapPackage(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<Buffer> {
  const p = parser(true, { xmlns: true, strictEntities: true }),
    decoder = new TextDecoder('utf-8', { fatal: true }),
    base64 = new Base64Decoder();
  const stack: string[] = [];
  let packageSeen = false,
    headerSeen = false,
    responseSeen = false,
    wrapperSeen = false,
    bodySeen = false,
    envelopeSeen = false,
    done = false,
    bytes = 0;
  const output: Buffer[] = [];
  const fail = () => {
    throw new SatError('SAT_SOAP_INVALID');
  };
  p.onerror = fail;
  p.ondoctype = fail;
  p.oncdata = fail;
  p.onprocessinginstruction = (instruction) => {
    if (instruction.name !== 'xml' || envelopeSeen) fail();
  };
  p.onopentag = (tag) => {
    const path = [...stack, tag.local].join('/');
    const allowed = [
      'Envelope',
      'Envelope/Header',
      'Envelope/Header/respuesta',
      'Envelope/Body',
      'Envelope/Body/RespuestaDescargaMasivaTercerosSalida',
      'Envelope/Body/RespuestaDescargaMasivaTercerosSalida/Paquete',
    ];
    if (
      done ||
      !allowed.includes(path) ||
      tag.uri !==
        (['Envelope', 'Header', 'Body'].includes(tag.local) ? SOAP : SAT)
    )
      fail();
    if (path === 'Envelope') {
      if (envelopeSeen) fail();
      envelopeSeen = true;
    }
    if (tag.local === 'Header') {
      if (headerSeen || bodySeen) fail();
      headerSeen = true;
    }
    if (tag.local === 'Body') {
      if (bodySeen || !headerSeen || !responseSeen) fail();
      bodySeen = true;
    }
    if (tag.local === 'RespuestaDescargaMasivaTercerosSalida') {
      if (wrapperSeen) fail();
      wrapperSeen = true;
    }
    if (tag.local === 'respuesta') {
      if (responseSeen) fail();
      responseSeen = true;
      const a = Object.values(tag.attributes).find(
        (x) => x.local === 'CodEstatus' && !x.uri,
      );
      if (a?.value === '5008') throw new SatError('SAT_DOWNLOAD_BUDGET');
      if (a?.value === '5007') throw new SatError('SAT_PACKAGE_EXPIRED');
      if (a?.value !== '5000') throw new SatError('SAT_DOWNLOAD_REJECTED');
    }
    if (tag.local === 'Paquete') {
      if (packageSeen) fail();
      packageSeen = true;
    }
    stack.push(tag.local);
  };
  p.onclosetag = () => {
    stack.pop();
    if (!stack.length) done = true;
  };
  p.ontext = (text) => {
    if (stack.at(-1) === 'Paquete') {
      const b = base64.write(text);
      if (b.length) output.push(b);
    } else if (text.trim()) fail();
  };
  for await (const chunk of source) {
    bytes += chunk.length;
    if (bytes > Math.ceil(SAT_PACKAGE_LIMITS.compressed / 3) * 4 + 1024 * 1024)
      throw new SatError('SAT_SOAP_LIMIT');
    for (let i = 0; i < chunk.length; i += 16384) {
      const text = decoder.decode(chunk.subarray(i, i + 16384), {
        stream: true,
      });
      if (text.includes('&')) fail();
      p.write(text);
      p.flush();
      while (output.length) yield output.shift()!;
    }
  }
  p.write(decoder.decode()).close();
  while (output.length) yield output.shift()!;
  if (
    !done ||
    !packageSeen ||
    !headerSeen ||
    !responseSeen ||
    !wrapperSeen ||
    !bodySeen
  )
    fail();
  base64.finish();
}
