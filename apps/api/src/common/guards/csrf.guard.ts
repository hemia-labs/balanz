import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;

    const origin = request.get('origin');
    if (!origin) return true;

    const nodeEnv = this.config.get<string>('app.nodeEnv', 'development');
    const allowedOrigins = this.config.get<string[]>('app.corsOrigins', []);
    if (nodeEnv !== 'production' && allowedOrigins.length === 0) return true;
    if (allowedOrigins.includes(origin)) return true;

    throw new ForbiddenException('Invalid request origin');
  }
}
