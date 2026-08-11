import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  getRequiredDatabaseUrl,
  getRequiredEnvironmentSecret,
} from '@tasktwin/database';
import type { LogLevel } from '@nestjs/common';

const DEFAULT_API_PORT = 3001;
const DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 900;
const MINIMUM_ACCESS_TOKEN_LIFETIME_SECONDS = 60;
const MAXIMUM_ACCESS_TOKEN_LIFETIME_SECONDS = 3_600;
const MINIMUM_JWT_SECRET_LENGTH = 32;
const MINIMUM_RUNNER_PEPPER_LENGTH = 32;

export interface JwtAccessConfiguration {
  secret: string;
  expiresInSeconds: number;
}

export interface RunnerSecurityConfiguration {
  pairingCodePepper: string;
  credentialPepper: string;
  webOrigin: string;
}

export interface RunnerJobSecurityConfiguration {
  leasePepper: string;
}

export function loadRootEnvironment(): void {
  if (process.env.NODE_ENV === 'production') return;

  const rootEnvironmentPath = fileURLToPath(
    new URL('../../../../.env', import.meta.url),
  );

  if (existsSync(rootEnvironmentPath)) {
    process.loadEnvFile(rootEnvironmentPath);
  }
}

export function getApiHost(): string {
  const configuredHost = process.env.API_HOST;
  if (configuredHost === undefined) {
    return process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
  }
  if (!/^[a-zA-Z0-9.:-]+$/u.test(configuredHost)) {
    throw new Error('API_HOST contains unsupported characters');
  }
  return configuredHost;
}

export function getApiLogLevels(): LogLevel[] {
  const configured = process.env.TASKTWIN_LOG_LEVEL ?? 'log';
  const levels: Record<string, LogLevel[]> = {
    error: ['error'],
    warn: ['error', 'warn'],
    log: ['error', 'warn', 'log'],
    debug: ['error', 'warn', 'log', 'debug'],
  };
  const result = levels[configured];
  if (result === undefined) {
    throw new Error('TASKTWIN_LOG_LEVEL must be error, warn, log, or debug');
  }
  return result;
}

export function getApiPort(): number {
  const configuredPort = process.env.API_PORT;
  if (configuredPort === undefined) {
    return DEFAULT_API_PORT;
  }

  const parsedPort = Number(configuredPort);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }

  return parsedPort;
}

export function getJwtAccessConfiguration(): JwtAccessConfiguration {
  const secret = getRequiredEnvironmentSecret('JWT_ACCESS_SECRET');
  if (secret.trim().length < MINIMUM_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_ACCESS_SECRET must contain at least ${MINIMUM_JWT_SECRET_LENGTH} characters`,
    );
  }

  const configuredLifetime = process.env.JWT_ACCESS_EXPIRES_IN;
  const expiresInSeconds =
    configuredLifetime === undefined
      ? DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS
      : Number(configuredLifetime);

  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < MINIMUM_ACCESS_TOKEN_LIFETIME_SECONDS ||
    expiresInSeconds > MAXIMUM_ACCESS_TOKEN_LIFETIME_SECONDS
  ) {
    throw new Error(
      `JWT_ACCESS_EXPIRES_IN must be an integer between ${MINIMUM_ACCESS_TOKEN_LIFETIME_SECONDS} and ${MAXIMUM_ACCESS_TOKEN_LIFETIME_SECONDS}`,
    );
  }

  return { secret, expiresInSeconds };
}

function getRequiredSecret(name: string): string {
  const value = getRequiredEnvironmentSecret(name);
  if (value.trim().length < MINIMUM_RUNNER_PEPPER_LENGTH) {
    throw new Error(
      `${name} must contain at least ${MINIMUM_RUNNER_PEPPER_LENGTH} characters`,
    );
  }
  return value;
}

export function validateApiEnvironment(): void {
  getRequiredDatabaseUrl();
  getApiHost();
  getApiPort();
  getApiLogLevels();
  getJwtAccessConfiguration();
  getRunnerSecurityConfiguration();
  getRunnerJobSecurityConfiguration();
}

export function validateSchedulerEnvironment(): void {
  getRequiredDatabaseUrl();
  getApiLogLevels();
}

function getHttpOrigin(name: string, fallback?: string): string {
  const configured = process.env[name] ?? fallback;
  if (configured === undefined) {
    throw new Error(`${name} is required`);
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) origin`);
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
      `${name} must be an HTTP(S) origin without credentials or a path`,
    );
  }
  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1';
  if (url.protocol !== 'https:' && !isLoopback) {
    throw new Error(`${name} must use HTTPS outside local development`);
  }
  return url.origin;
}

export function getRunnerSecurityConfiguration(): RunnerSecurityConfiguration {
  return {
    pairingCodePepper: getRequiredSecret('RUNNER_PAIRING_CODE_PEPPER'),
    credentialPepper: getRequiredSecret('RUNNER_CREDENTIAL_PEPPER'),
    webOrigin: getHttpOrigin(
      'TASKTWIN_WEB_BASE_URL',
      process.env.NODE_ENV === 'production'
        ? undefined
        : 'http://127.0.0.1:3000',
    ),
  };
}

export function getRunnerJobSecurityConfiguration(): RunnerJobSecurityConfiguration {
  return {
    leasePepper: getRequiredSecret('RUNNER_JOB_LEASE_PEPPER'),
  };
}
