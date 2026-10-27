import Busboy from 'busboy';
import type { Request } from 'express';
import { efirmaError } from './efirma.errors';

export interface ReceivedCredentials {
  certificate: Buffer;
  encryptedKey: Buffer;
  password: Buffer;
  grant: string;
  replacesId?: string;
  dispose(): void;
}

/** Never use multer disk storage or the application's JSON body parser for credentials. */
export async function receiveCredentials(
  request: Request,
): Promise<ReceivedCredentials> {
  const buffers: Buffer[] = [];
  const files = new Map<string, Buffer>();
  const fields = new Map<string, string>();
  let invalid = false;
  let total = 0;
  const dispose = () => {
    for (const buffer of buffers) buffer.fill(0);
    fields.clear();
    files.clear();
  };
  try {
    if (Number(request.headers['content-length'] ?? 0) > 40000)
      throw new Error();
    const parser = Busboy({
      headers: request.headers,
      limits: {
        files: 2,
        fields: 3,
        parts: 5,
        fileSize: 16384,
        fieldSize: 1024,
        fieldNameSize: 32,
      },
    });
    await new Promise<void>((resolve, reject) => {
      const fail = () => {
        invalid = true;
        request.unpipe(parser);
        parser.destroy();
        reject(efirmaError('EFIRMA_INPUT_INVALID', 400));
      };
      const count = (chunk: Buffer) => {
        total += chunk.length;
        if (total > 40000) fail();
      };
      request.on('data', count);
      request.once('aborted', fail);
      parser
        .on('filesLimit', fail)
        .on('fieldsLimit', fail)
        .on('partsLimit', fail)
        .on('error', fail);
      parser.on('field', (name, value, info) => {
        if (
          !['password', 'grant', 'replacesId'].includes(name) ||
          fields.has(name) ||
          info.valueTruncated ||
          info.nameTruncated
        )
          invalid = true;
        fields.set(name, value);
      });
      const seen = new Set<string>();
      parser.on('file', (name, stream, info) => {
        const expected =
          name === 'certificate' ? '.cer' : name === 'key' ? '.key' : null;
        if (
          !expected ||
          seen.has(name) ||
          !info.filename.toLowerCase().endsWith(expected)
        )
          invalid = true;
        seen.add(name);
        const chunks: Buffer[] = [];
        stream.on('limit', () => {
          invalid = true;
        });
        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          buffers.push(chunk);
        });
        stream.on('end', () => {
          const content = Buffer.concat(chunks);
          buffers.push(content);
          files.set(name, content);
        });
      });
      parser.once('close', () => {
        request.removeListener('data', count);
        request.removeListener('aborted', fail);
        resolve();
      });
      request.pipe(parser);
    });
    const certificate = files.get('certificate');
    const encryptedKey = files.get('key');
    const password = Buffer.from(fields.get('password') ?? '', 'utf8');
    buffers.push(password);
    const grant = fields.get('grant') ?? '';
    const replacesId = fields.get('replacesId');
    if (
      invalid ||
      !certificate?.length ||
      !encryptedKey?.length ||
      !password.length ||
      password.length > 1024 ||
      !/^[0-9a-f]{64}$/.test(grant) ||
      (replacesId && !/^[0-9a-f-]{36}$/i.test(replacesId))
    )
      throw new Error();
    fields.clear();
    return { certificate, encryptedKey, password, grant, replacesId, dispose };
  } catch {
    dispose();
    throw efirmaError('EFIRMA_INPUT_INVALID', 400);
  }
}
