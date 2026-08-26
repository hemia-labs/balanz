import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

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

    let message: string | string[] =
      'Ocurrió un error inesperado. Intenta de nuevo.';
    let error = 'InternalServerError';
    let code: string | undefined;
    let fieldErrors: Record<string, string[]> | undefined;

    if (exception instanceof HttpException) {
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
    } else if (exception instanceof Error) {
      // 5xx inesperado: loguear stack, no filtrarlo al cliente.
      this.logger.error(
        `[${request.correlationId}] ${exception.message}`,
        exception.stack,
      );
    }

    const errorBody: ErrorBody = {
      statusCode: status,
      message,
      error,
      ...(code ? { code } : {}),
      ...(fieldErrors ? { fieldErrors } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
      correlationId: request.correlationId,
    };

    response.status(status).json(errorBody);
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
