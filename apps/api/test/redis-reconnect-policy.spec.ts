import {
  REDIS_RECONNECT_MAX_DELAY_MS,
  REDIS_RECONNECT_MIN_DELAY_MS,
  redisReconnectDelayMs,
} from '../src/modules/redis/redis-reconnect-policy';

describe('redisReconnectDelayMs', () => {
  it('backs off from five seconds with additive jitter', () => {
    expect(redisReconnectDelayMs(0, () => 0)).toBe(
      REDIS_RECONNECT_MIN_DELAY_MS,
    );
    expect(redisReconnectDelayMs(0, () => 0.999)).toBe(5_999);
    expect(redisReconnectDelayMs(1, () => 0)).toBe(10_000);
    expect(redisReconnectDelayMs(2, () => 0)).toBe(20_000);
  });

  it('caps retry delays below the thirty-second ceiling', () => {
    expect(redisReconnectDelayMs(99, () => 0)).toBe(29_000);
    expect(redisReconnectDelayMs(99, () => 1)).toBeLessThanOrEqual(
      REDIS_RECONNECT_MAX_DELAY_MS,
    );
  });

  it('normalizes invalid retry counters and random samples safely', () => {
    expect(redisReconnectDelayMs(Number.NaN, () => -1)).toBe(
      REDIS_RECONNECT_MIN_DELAY_MS,
    );
    expect(redisReconnectDelayMs(-10, () => 2)).toBe(5_999);
  });
});
