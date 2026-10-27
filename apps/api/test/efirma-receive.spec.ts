import { PassThrough } from 'node:stream';
import type { Request } from 'express';
import { receiveCredentials } from '../src/modules/efirma/receive-credentials';

function request(
  parts: { name: string; value: Buffer | string; filename?: string }[],
) {
  const boundary = 'synthetic-boundary';
  const chunks: Buffer[] = [];
  for (const part of parts)
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ''}\r\n${part.filename ? 'Content-Type: application/octet-stream\r\n' : ''}\r\n`,
      ),
      Buffer.from(part.value),
      Buffer.from('\r\n'),
    );
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const stream = new PassThrough() as PassThrough & {
    headers: Record<string, string>;
  };
  stream.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
  };
  const result = receiveCredentials(stream as unknown as Request);
  stream.end(Buffer.concat(chunks));
  return result;
}
const parts = () => [
  {
    name: 'certificate',
    filename: 'synthetic.cer',
    value: Buffer.from('synthetic certificate'),
  },
  {
    name: 'key',
    filename: 'synthetic.key',
    value: Buffer.from('synthetic encrypted key'),
  },
  { name: 'password', value: 'synthetic-password' },
  { name: 'grant', value: 'a'.repeat(64) },
];
describe('bounded in-memory credential reception', () => {
  it('receives exactly the files and disposes their buffers', async () => {
    const input = await request(parts());
    expect(input.password.toString()).toBe('synthetic-password');
    input.dispose();
    expect(input.password.every((value) => value === 0)).toBe(true);
    expect(input.encryptedKey.every((value) => value === 0)).toBe(true);
  });
  it('rejects a certificate exceeding 16 KiB', async () => {
    const values = parts();
    values[0].value = Buffer.alloc(16385);
    await expect(request(values)).rejects.toMatchObject({
      response: { code: 'EFIRMA_INPUT_INVALID' },
    });
  });
  it('rejects duplicate files', async () => {
    await expect(request([...parts(), parts()[0]])).rejects.toMatchObject({
      response: { code: 'EFIRMA_INPUT_INVALID' },
    });
  });
  it('rejects ambiguous file extension', async () => {
    const values = parts();
    values[0].filename = 'certificate.cer.exe';
    await expect(request(values)).rejects.toMatchObject({
      response: { code: 'EFIRMA_INPUT_INVALID' },
    });
  });
  it('rejects password bytes over the limit', async () => {
    const values = parts();
    values[2].value = 'ñ'.repeat(600);
    await expect(request(values)).rejects.toMatchObject({
      response: { code: 'EFIRMA_INPUT_INVALID' },
    });
  });
  it('rejects missing grant and arbitrary form fields', async () => {
    const values = parts();
    values[3].name = 'url';
    await expect(request(values)).rejects.toMatchObject({
      response: { code: 'EFIRMA_INPUT_INVALID' },
    });
  });
});
