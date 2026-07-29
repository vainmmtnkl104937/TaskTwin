import { afterEach, describe, expect, it } from 'vitest';

import { getApiPort, getJwtAccessConfiguration } from './environment.js';

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
});
