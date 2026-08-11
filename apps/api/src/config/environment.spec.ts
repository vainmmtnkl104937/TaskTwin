import { afterEach, describe, expect, it } from 'vitest';

import {
  getApiHost,
  getApiLogLevels,
  getApiPort,
  getJwtAccessConfiguration,
  getRunnerSecurityConfiguration,
} from './environment.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('environment configuration', () => {
  it('validates the JWT secret and access token lifetime', () => {
    process.env.JWT_ACCESS_SECRET = 'a-secure-test-secret-with-32-characters';
    process.env.JWT_ACCESS_EXPIRES_IN = '900';

    expect(getJwtAccessConfiguration()).toEqual({
      secret: 'a-secure-test-secret-with-32-characters',
      expiresInSeconds: 900,
    });
  });

  it('rejects a short JWT secret', () => {
    process.env.JWT_ACCESS_SECRET = 'too-short';

    expect(() => getJwtAccessConfiguration()).toThrow(
      'JWT_ACCESS_SECRET must contain at least 32 characters',
    );
  });

  it('rejects access token lifetimes outside the safe bound', () => {
    process.env.JWT_ACCESS_SECRET = 'a-secure-test-secret-with-32-characters';
    process.env.JWT_ACCESS_EXPIRES_IN = '3601';

    expect(() => getJwtAccessConfiguration()).toThrow(
      'JWT_ACCESS_EXPIRES_IN must be an integer between 60 and 3600',
    );
  });

  it('validates API_PORT', () => {
    process.env.API_PORT = '70000';
    expect(() => getApiPort()).toThrow(
      'API_PORT must be an integer between 1 and 65535',
    );
  });

  it('uses a container-reachable host and bounded logging in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.API_HOST;
    process.env.TASKTWIN_LOG_LEVEL = 'warn';

    expect(getApiHost()).toBe('0.0.0.0');
    expect(getApiLogLevels()).toEqual(['error', 'warn']);
  });

  it('rejects unknown production log levels', () => {
    process.env.TASKTWIN_LOG_LEVEL = 'trace';
    expect(() => getApiLogLevels()).toThrow(
      'TASKTWIN_LOG_LEVEL must be error, warn, log, or debug',
    );
  });

  it('validates runner peppers and the verification origin', () => {
    process.env.RUNNER_PAIRING_CODE_PEPPER = 'p'.repeat(32);
    process.env.RUNNER_CREDENTIAL_PEPPER = 'c'.repeat(32);
    process.env.TASKTWIN_WEB_BASE_URL = 'https://tasktwin.example';

    expect(getRunnerSecurityConfiguration()).toEqual({
      pairingCodePepper: 'p'.repeat(32),
      credentialPepper: 'c'.repeat(32),
      webOrigin: 'https://tasktwin.example',
    });
  });

  it('rejects insecure non-loopback runner verification origins', () => {
    process.env.RUNNER_PAIRING_CODE_PEPPER = 'p'.repeat(32);
    process.env.RUNNER_CREDENTIAL_PEPPER = 'c'.repeat(32);
    process.env.TASKTWIN_WEB_BASE_URL = 'http://tasktwin.example';

    expect(() => getRunnerSecurityConfiguration()).toThrow(
      'TASKTWIN_WEB_BASE_URL must use HTTPS outside local development',
    );
  });

  it('requires an explicit runner verification origin in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.RUNNER_PAIRING_CODE_PEPPER = 'p'.repeat(32);
    process.env.RUNNER_CREDENTIAL_PEPPER = 'c'.repeat(32);
    delete process.env.TASKTWIN_WEB_BASE_URL;

    expect(() => getRunnerSecurityConfiguration()).toThrow(
      'TASKTWIN_WEB_BASE_URL is required',
    );
  });
});
