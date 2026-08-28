import { registerAs } from '@nestjs/config';

export interface HorusConfig {
  endpoint?: string;
  key?: string;
  release?: string;
  timeoutMs: number;
}

export default registerAs('horus', (): HorusConfig => ({
  endpoint: process.env.HORUS_URL?.trim() || undefined,
  key: process.env.HORUS_KEY?.trim() || undefined,
  release: process.env.HORUS_RELEASE?.trim() || undefined,
  timeoutMs: Number(process.env.HORUS_TIMEOUT_MS) || 2_000,
}));
