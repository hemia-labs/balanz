import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FiscalPlatformConfig } from '../../config/fiscal-platform.config';
import { FiscalMetricsService } from '../../common/observability/fiscal-metrics.service';
import { REDIS_CLIENT } from './redis.tokens';
import type { RedisClient } from './redis.module';
import { shutdownRedisClient } from './redis-client-shutdown';

const WAKEUP_PAYLOAD = '1';

export interface RedisWakeupStatus {
  configured: boolean;
  publisherReady: boolean;
  subscriberReady: boolean;
  publishFailures: number;
  subscriptionFailures: number;
  lastFailureAt?: string;
}

type WakeupListener = () => void;

/**
 * Redis is only an acceleration signal. The durable worker must keep its
 * PostgreSQL poller active regardless of this service's state.
 */
@Injectable()
export class RedisWakeupService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisWakeupService.name);
  private readonly listeners = new Set<WakeupListener>();
  private readonly enabled: boolean;
  private readonly channel: string;
  private readonly timeoutMs: number;
  private subscriber: RedisClient | null = null;
  private subscriberStarting = false;
  private subscriberSubscribed = false;
  private subscriberRetryTimer?: NodeJS.Timeout;
  private subscriberRetryAttempt = 0;
  private shuttingDown = false;
  private publishFailures = 0;
  private subscriptionFailures = 0;
  private lastFailureAt?: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly publisher: RedisClient | null,
    config: ConfigService,
    private readonly metrics: FiscalMetricsService,
  ) {
    const fiscal = config.getOrThrow<FiscalPlatformConfig>('fiscalPlatform');
    this.enabled = fiscal.redisWakeup.enabled;
    this.channel = fiscal.redisWakeup.channel;
    this.timeoutMs = fiscal.redisWakeup.timeoutMs;
  }

  /** Call only after the transaction that made work visible has committed. */
  async publishJobsAvailable(): Promise<boolean> {
    if (!this.enabled) return false;
    if (!this.publisher?.isReady) {
      this.metrics.increment('redis_wakeup_failures_total', {
        stage: 'publish',
      });
      this.recordFailure(
        'Redis wakeup publisher unavailable; polling remains active',
      );
      return false;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref();

    try {
      await this.publisher
        .withAbortSignal(controller.signal)
        .publish(this.channel, WAKEUP_PAYLOAD);
      return true;
    } catch {
      this.metrics.increment('redis_wakeup_failures_total', {
        stage: 'publish',
      });
      this.recordFailure('Redis wakeup publish failed; polling remains active');
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  subscribe(listener: WakeupListener): () => void {
    this.listeners.add(listener);
    this.ensureSubscriberStarted();
    return () => this.listeners.delete(listener);
  }

  status(): RedisWakeupStatus {
    return {
      configured: this.enabled,
      publisherReady: this.publisher?.isReady ?? false,
      subscriberReady:
        this.subscriberSubscribed && (this.subscriber?.isReady ?? false),
      publishFailures: this.publishFailures,
      subscriptionFailures: this.subscriptionFailures,
      lastFailureAt: this.lastFailureAt,
    };
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.subscriberRetryTimer) clearTimeout(this.subscriberRetryTimer);
    const subscriber = this.subscriber;
    this.subscriber = null;
    this.subscriberSubscribed = false;
    this.listeners.clear();
    if (!subscriber) return;

    await shutdownRedisClient(subscriber, this.timeoutMs);
  }

  private ensureSubscriberStarted(): void {
    if (
      !this.enabled ||
      this.shuttingDown ||
      !this.publisher ||
      this.subscriber ||
      this.subscriberStarting
    ) {
      return;
    }

    this.subscriberStarting = true;
    const subscriber = this.publisher.duplicate();
    this.subscriber = subscriber;
    subscriber.on('error', () => {
      this.recordFailure(
        'Redis wakeup subscriber unavailable; polling remains active',
        true,
      );
    });

    void subscriber
      .connect()
      .then(async () => {
        await subscriber.subscribe(this.channel, (message) => {
          if (message !== WAKEUP_PAYLOAD) return;
          for (const listener of this.listeners) {
            try {
              listener();
            } catch {
              this.logger.warn('Redis wakeup listener failed safely');
            }
          }
        });
        if (this.subscriber === subscriber) {
          this.subscriberSubscribed = true;
          this.subscriberRetryAttempt = 0;
        }
      })
      .catch(async () => {
        this.subscriberSubscribed = false;
        this.recordFailure(
          'Redis wakeup subscription failed; polling remains active',
          true,
        );
        if (this.subscriber === subscriber) this.subscriber = null;
        await shutdownRedisClient(subscriber, this.timeoutMs);
        this.scheduleSubscriberRetry();
      })
      .finally(() => {
        this.subscriberStarting = false;
      });
  }

  private scheduleSubscriberRetry(): void {
    if (
      this.shuttingDown ||
      this.subscriberRetryTimer ||
      this.listeners.size === 0
    ) {
      return;
    }
    const retryDelayMs = Math.min(
      30_000,
      Math.max(this.timeoutMs, 1_000) * 2 ** this.subscriberRetryAttempt,
    );
    this.subscriberRetryAttempt = Math.min(this.subscriberRetryAttempt + 1, 5);
    this.subscriberRetryTimer = setTimeout(() => {
      this.subscriberRetryTimer = undefined;
      this.ensureSubscriberStarted();
    }, retryDelayMs);
    this.subscriberRetryTimer.unref();
  }

  private recordFailure(message: string, subscription = false): void {
    if (subscription) this.subscriptionFailures += 1;
    else this.publishFailures += 1;
    this.lastFailureAt = new Date().toISOString();
    if (subscription) {
      this.metrics.increment('redis_wakeup_failures_total', {
        stage: 'subscribe',
      });
    }
    this.logger.warn(message);
  }
}
