import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticCredential } from './fixtures/efirma-fixture';
import { CertificateValidator } from '../src/modules/efirma/certificate-validator';

describe('isolated synthetic credential validation', () => {
  let directory: string;
  let fixture: Awaited<ReturnType<typeof syntheticCredential>>;
  let validator: CertificateValidator;
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'hemia-trust-'));
    fixture = await syntheticCredential();
    writeFileSync(join(directory, 'trust.json'), JSON.stringify(fixture.trust));
    validator = new CertificateValidator(join(directory, 'trust.json'));
  });
  afterAll(() => {
    fixture?.password.fill(0);
    rmSync(directory, { recursive: true, force: true });
  });
  it('validates chain, RFC, key correspondence and protected key', async () => {
    const result = await validator.validate(
      fixture.certificate,
      fixture.encryptedKey,
      fixture.password,
      'AAA010101AAA',
    );
    expect(result.certificate.checkPrivateKey(result.key)).toBe(true);
  });
  it('rejects an incorrect password with a safe error', async () => {
    await expect(
      validator.validate(
        fixture.certificate,
        fixture.encryptedKey,
        Buffer.from('wrong'),
        'AAA010101AAA',
      ),
    ).rejects.toMatchObject({
      response: { code: 'EFIRMA_KEY_PASSWORD_INVALID' },
    });
  });
  it('rejects foreign RFC', async () => {
    await expect(
      validator.validate(
        fixture.certificate,
        fixture.encryptedKey,
        fixture.password,
        'BBB010101BBB',
      ),
    ).rejects.toMatchObject({ response: { code: 'EFIRMA_RFC_MISMATCH' } });
  });
  it('rejects expired certificates', async () => {
    const now = jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 4 * 86400000);
    try {
      await expect(
        validator.validate(
          fixture.certificate,
          fixture.encryptedKey,
          fixture.password,
          'AAA010101AAA',
        ),
      ).rejects.toMatchObject({
        response: { code: 'EFIRMA_CERTIFICATE_EXPIRED' },
      });
    } finally {
      now.mockRestore();
    }
  });
  it('rejects unregistered input before invoking the PKCS8 KDF', async () => {
    await expect(
      validator.validate(
        fixture.certificate,
        Buffer.alloc(16000),
        fixture.password,
        'AAA010101AAA',
      ),
    ).rejects.toMatchObject({
      response: { code: 'EFIRMA_CERTIFICATE_PROFILE_REJECTED' },
    });
  });
  it('rejects a CSD-like synthetic profile, even with registered hashes', async () => {
    const other = await syntheticCredential('HEMIA SYNTHETIC CSD');
    const path = join(directory, 'wrong-profile.json');
    writeFileSync(path, JSON.stringify(other.trust));
    try {
      await expect(
        new CertificateValidator(path).validate(
          other.certificate,
          other.encryptedKey,
          other.password,
          'AAA010101AAA',
        ),
      ).rejects.toMatchObject({
        response: { code: 'EFIRMA_CERTIFICATE_PROFILE_REJECTED' },
      });
    } finally {
      other.password.fill(0);
    }
  });
  it('rejects a different registered private key', async () => {
    const other = await syntheticCredential();
    const path = join(directory, 'key-mismatch.json');
    writeFileSync(
      path,
      JSON.stringify({
        ...fixture.trust,
        encryptedKeys: other.trust.encryptedKeys,
      }),
    );
    try {
      await expect(
        new CertificateValidator(path).validate(
          fixture.certificate,
          other.encryptedKey,
          other.password,
          'AAA010101AAA',
        ),
      ).rejects.toMatchObject({ response: { code: 'EFIRMA_KEY_MISMATCH' } });
    } finally {
      other.password.fill(0);
    }
  });
  it('rejects a modified certificate signature against the trusted root', async () => {
    const changed = Buffer.from(fixture.certificate);
    changed[changed.length - 1] ^= 1;
    await expect(
      validator.validate(
        changed,
        fixture.encryptedKey,
        fixture.password,
        'AAA010101AAA',
      ),
    ).rejects.toMatchObject({
      response: { code: 'EFIRMA_CERTIFICATE_PROFILE_REJECTED' },
    });
  });
});
