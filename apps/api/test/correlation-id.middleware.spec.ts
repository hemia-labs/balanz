import { CorrelationIdMiddleware } from '../src/common/middleware/correlation-id.middleware';
import { CorrelationIdService } from '../src/common/correlation/correlation-id.service';

describe('CorrelationIdMiddleware', () => {
  it('keeps a valid UUID and exposes it in the response', () => {
    const correlationId = '550e8400-e29b-41d4-a716-446655440000';
    const request = { get: jest.fn().mockReturnValue(correlationId) } as never;
    const response = { setHeader: jest.fn() } as never;
    const next = jest.fn();

    new CorrelationIdMiddleware(new CorrelationIdService()).use(
      request,
      response,
      next,
    );

    expect((request as { correlationId: string }).correlationId).toBe(
      correlationId,
    );
    expect(
      (response as { setHeader: jest.Mock }).setHeader,
    ).toHaveBeenCalledWith('x-correlation-id', correlationId);
    expect(next).toHaveBeenCalled();
  });

  it('replaces an invalid value with a UUID', () => {
    const request = { get: jest.fn().mockReturnValue('unsafe') } as never;
    const response = { setHeader: jest.fn() } as never;
    new CorrelationIdMiddleware(new CorrelationIdService()).use(
      request,
      response,
      jest.fn(),
    );
    expect((request as { correlationId: string }).correlationId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});
