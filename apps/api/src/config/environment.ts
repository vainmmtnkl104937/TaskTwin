import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_API_PORT = 3001;
const DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 900;
const MINIMUM_ACCESS_TOKEN_LIFETIME_SECONDS = 60;
const MAXIMUM_ACCESS_TOKEN_LIFETIME_SECONDS = 3_600;
const MINIMUM_JWT_SECRET_LENGTH = 32;

export interface JwtAccessConfiguration {
  secret: string;
  expiresInSeconds: number;
}

export function loadRootEnvironment(): void {
  const rootEnvironmentPath = fileURLToPath(
    new URL('../../../../.env', import.meta.url),
  );

  if (existsSync(rootEnvironmentPath)) {
    process.loadEnvFile(rootEnvironmentPath);
  }
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
  const secret = process.env.JWT_ACCESS_SECRET;
  if (
    secret === undefined ||
    secret.trim().length < MINIMUM_JWT_SECRET_LENGTH
  ) {
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
