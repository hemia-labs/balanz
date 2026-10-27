import { execFileSync } from 'node:child_process';
import type { Request, Response } from 'express';
import { EfirmaController } from '../src/modules/efirma/efirma.controller';
import { EfirmaRepository } from '../src/modules/efirma/efirma.repository';
import { EfirmaPreparationService } from '../src/modules/efirma/efirma-preparation.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { SessionsService } from '../src/modules/sessions/sessions.service';
import { AuthSession } from '../src/modules/sessions/entities/auth-session.entity';
import type { RequestContext } from '../src/common/decorators/request-context.decorator';

describe('fiscal reauthentication boundary', () => {
  const session = {
    id: 'old-session',
    reauthenticatedAt: new Date(),
  } as AuthSession;
  const request = { ip: '127.0.0.1' } as Request;
  const response = { setHeader: jest.fn() } as unknown as Response;
  const context = { correlationId: 'correlation' } as RequestContext;
  it('requires fresh MFA even when general reauthentication is recent', async () => {
    const repository = {
      generation: jest.fn().mockResolvedValue('generation'),
      issueGrant: jest.fn(),
    };
    const auth = {
      reauthenticate: jest
        .fn()
        .mockRejectedValue(new Error('MFA replay rejected')),
    };
    const controller = new EfirmaController(
      repository as unknown as EfirmaRepository,
      {} as EfirmaPreparationService,
      auth as unknown as AuthService,
      {} as SessionsService,
    );
    await expect(
      controller.grant(
        'entity',
        { code: '123456' },
        session,
        request,
        response,
        context,
      ),
    ).rejects.toThrow('MFA replay rejected');
    expect(repository.issueGrant).not.toHaveBeenCalled();
  });
  it('binds the grant to the resulting rotated authorization and sets its cookie', async () => {
    const rotated = { sessionId: 'result-session' };
    const repository = {
      generation: jest.fn().mockResolvedValue('generation'),
      issueGrant: jest.fn().mockResolvedValue({ grant: 'opaque' }),
    };
    const auth = {
      reauthenticate: jest.fn().mockResolvedValue({
        rawSessionToken: 'rotated-cookie',
        context: rotated,
      }),
    };
    const sessions = { setCookie: jest.fn() };
    const controller = new EfirmaController(
      repository as unknown as EfirmaRepository,
      {} as EfirmaPreparationService,
      auth as unknown as AuthService,
      sessions as unknown as SessionsService,
    );
    await controller.grant(
      'entity',
      { code: '123456' },
      session,
      request,
      response,
      context,
    );
    expect(sessions.setCookie).toHaveBeenCalledWith(response, 'rotated-cookie');
    expect(repository.issueGrant).toHaveBeenCalledWith(
      rotated,
      'entity',
      'correlation',
    );
  });
  it('reuses the real TOTP service with replay protection', () => {
    const result = execFileSync(
      process.execPath,
      [
        '-r',
        'ts-node/register/transpile-only',
        '-e',
        "const {TotpService}=require('./src/modules/auth/totp.service');(async()=>{const s=new TotpService();const first=await s.verify('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ','287082',null,59);const second=await s.verify('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ','287082',String(first.timeStep),59);console.log(JSON.stringify([first.valid,second.valid]));})().catch(()=>process.exit(1));",
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 },
    );
    expect(JSON.parse(result)).toEqual([true, false]);
  });
});
