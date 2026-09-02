import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { MetricsController } from '../src/common/observability/metrics.controller';
import { FiscalMetricsService } from '../src/common/observability/fiscal-metrics.service';
import {
  FISCAL_PROCESS_NAME,
  FiscalHealthController,
} from '../src/modules/health/fiscal-health.controller';
import { FiscalReadinessService } from '../src/modules/health/fiscal-readiness.service';

describe('fiscal operational HTTP endpoints', () => {
  let app: INestApplication;
  let server: App;
  const readiness = {
    liveness: jest.fn(),
    check: jest.fn(),
  };

  beforeEach(async () => {
    readiness.liveness.mockReturnValue({ status: 'up', process: 'api' });
    readiness.check.mockResolvedValue({
      status: 'degraded',
      process: 'api',
      dependencies: {
        postgres: { status: 'up', durationMs: 1 },
        storage: { status: 'up', provider: 'local', durationMs: 1 },
        scanner: { status: 'up', scanner: 'clamav', durationMs: 1 },
        redisWakeup: { status: 'down', required: false },
      },
    });
    const module = await Test.createTestingModule({
      controllers: [FiscalHealthController, MetricsController],
      providers: [
        FiscalMetricsService,
        { provide: FISCAL_PROCESS_NAME, useValue: 'api' },
        { provide: FiscalReadinessService, useValue: readiness },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    server = (
      app as unknown as {
        getHttpServer(): App;
      }
    ).getHttpServer();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await app.close();
  });

  it('serves liveness and keeps Redis-only degradation HTTP-ready', async () => {
    await request(server)
      .get('/liveness')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect((response) => {
        const body: unknown = response.body;
        expect(body).toEqual({ status: 'up', process: 'api' });
      });
    await request(server)
      .get('/readiness')
      .expect(200)
      .expect((response) => {
        const body: unknown = response.body;
        expect(body).toMatchObject({
          status: 'degraded',
          dependencies: {
            redisWakeup: {
              status: 'down',
              required: false,
            },
          },
        });
      });
  });

  it('returns 503 when a required dependency is down', async () => {
    readiness.check.mockResolvedValue({
      status: 'down',
      process: 'api',
      dependencies: {},
    });
    await request(server).get('/readiness').expect(503);
  });

  it('serves Prometheus text without fiscal identifiers', async () => {
    const metrics = app.get(FiscalMetricsService);
    metrics.increment('ingestion_jobs_created_total', {
      source: 'manual_xml',
    });
    await request(server)
      .get('/metrics')
      .expect(200)
      .expect('Content-Type', /text\/plain/)
      .expect(({ text }) => {
        expect(text).toContain(
          'ingestion_jobs_created_total{source="manual_xml"} 1',
        );
        expect(text).not.toContain('organization_id');
      });
  });
});
