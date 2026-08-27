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

    const allowedOrigins = this.config.get<string[]>('app.corsOrigins', []);
    const originHeader = request.get('origin');
    const refererHeader = request.get('referer');
    const candidate = originHeader ?? refererHeader;
    if (!candidate) {
      throw new ForbiddenException('Missing request origin');
    }

    let requestOrigin: string;
    try {
      const parsed = new URL(candidate);
      if (!parsed.protocol.startsWith('http') || parsed.origin === 'null') {
        throw new Error('unsupported origin');
      }
      requestOrigin = parsed.origin;
      if (originHeader && candidate !== requestOrigin) {
        throw new Error('origin must not contain a path');
      }
    } catch {
      throw new ForbiddenException('Invalid request origin');
    }

    if (allowedOrigins.includes(requestOrigin)) return true;

    throw new ForbiddenException('Invalid request origin');
  }
}
