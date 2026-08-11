import 'server-only';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

function loadRootEnvironment(): void {
  if (loaded) {
    return;
  }
  loaded = true;

  if (process.env.NODE_ENV === 'production') return;

  const rootEnvironmentPath = resolve(process.cwd(), '..', '..', '.env');
  if (existsSync(rootEnvironmentPath)) {
    process.loadEnvFile(rootEnvironmentPath);
  }
}

export function getControlPlaneOrigin(): string {
  loadRootEnvironment();
  const configured = process.env.TASKTWIN_API_BASE_URL;
  if (configured === undefined && process.env.NODE_ENV === 'production') {
    throw new Error('TASKTWIN_API_BASE_URL is required in production.');
  }
  const value = configured ?? 'http://127.0.0.1:3001';

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TASKTWIN_API_BASE_URL must be a valid URL origin.');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(
      'TASKTWIN_API_BASE_URL must be an HTTP(S) origin without credentials.',
    );
  }

  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1';
  if (
    process.env.NODE_ENV === 'production' &&
    url.protocol !== 'https:' &&
    !isLoopback &&
    process.env.TASKTWIN_ALLOW_HTTP_INTERNAL_API !== 'true'
  ) {
    throw new Error(
      'TASKTWIN_API_BASE_URL must use HTTPS unless internal HTTP is explicitly allowed.',
    );
  }

  return url.origin;
}

export function getWebReadinessTimeoutMs(): number {
  loadRootEnvironment();
  const configured = process.env.TASKTWIN_WEB_READINESS_TIMEOUT_MS ?? '3000';
  const value = Number(configured);
  if (!Number.isInteger(value) || value < 250 || value > 10_000) {
    throw new Error(
      'TASKTWIN_WEB_READINESS_TIMEOUT_MS must be an integer between 250 and 10000.',
    );
  }
  return value;
}

export function validateWebEnvironment(): void {
  getControlPlaneOrigin();
  getWebReadinessTimeoutMs();
}
