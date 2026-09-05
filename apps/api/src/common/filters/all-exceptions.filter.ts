import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { captureException } from '@hemia/horus';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  code?: string;
  fieldErrors?: Record<string, string[]>;
  path: string;
  timestamp: string;
  correlationId: string;
}

const SAFE_HTTP_METHODS = new Set([
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
]);
const SAFE_CORRELATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_TRACEPARENT = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i;
const CANONICAL_TELEMETRY_ERROR = 'UNHANDLED_INTERNAL_SERVER_ERROR';

// Filtro global: normaliza toda respuesta de error a un shape estable.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const method = this.safeMethod(request.method);
    const path = this.safePath(request.path);
    const correlationId = this.safeCorrelationId(request.correlationId);

    if (status >= 500) {
      const telemetryError = new Error(CANONICAL_TELEMETRY_ERROR);
      telemetryError.name = 'UnhandledInternalServerError';
      const traceparent = this.safeTraceparent(request.headers.traceparent);
      void Promise.resolve()
        .then(() =>
          captureException(telemetryError, {
            request: { method, url: path },
            ...(traceparent ? { trace_id: traceparent } : {}),
            tags: { correlation_id: correlationId },
          }),
        )
        .catch(() => undefined);
      this.logger.error({
        event: 'unhandled_internal_server_error',
        code: CANONICAL_TELEMETRY_ERROR,
        statusCode: status,
        correlationId,
        method,
        path,
      });
    }

    let message: string | string[] =
      'Ocurrió un error inesperado. Intenta de nuevo.';
    let error = 'InternalServerError';
    let code: string | undefined;
    let fieldErrors: Record<string, string[]> | undefined;

    if (exception instanceof HttpException && status < 500) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else {
        const body = res as Record<string, unknown>;
        message = (body.message as string | string[]) ?? exception.message;
        error = (body.error as string) ?? exception.name;
        code = typeof body.code === 'string' ? body.code : undefined;
        fieldErrors = this.fieldErrors(body.fieldErrors);
      }
    }

    const errorBody: ErrorBody = {
      statusCode: status,
      message,
      error,
      ...(code ? { code } : {}),
      ...(fieldErrors ? { fieldErrors } : {}),
      path,
      timestamp: new Date().toISOString(),
      correlationId,
    };

    response.status(status).json(errorBody);
  }

  private safeMethod(value: unknown): string {
    return typeof value === 'string' && SAFE_HTTP_METHODS.has(value)
      ? value
      : 'UNKNOWN';
  }

  private safePath(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !value.startsWith('/') ||
      value.length > 2_048 ||
      /[\r\n?#]/.test(value)
    ) {
      return '/';
    }
    return value;
  }

  private safeCorrelationId(value: unknown): string {
    return typeof value === 'string' && SAFE_CORRELATION_ID.test(value)
      ? value
      : 'unavailable';
  }

  private safeTraceparent(value: unknown): string | undefined {
    return typeof value === 'string' && SAFE_TRACEPARENT.test(value)
      ? value.toLowerCase()
      : undefined;
  }

  private fieldErrors(value: unknown): Record<string, string[]> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const entries = Object.entries(value).flatMap(([field, messages]) => {
      if (!Array.isArray(messages)) return [];
      const safeMessages = messages.filter(
        (message): message is string => typeof message === 'string',
      );
      return safeMessages.length > 0 ? [[field, safeMessages] as const] : [];
    });
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
}
