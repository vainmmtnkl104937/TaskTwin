import { afterEach, describe, expect, it, vi } from 'vitest';

describe('web server environment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('loads the root environment through a filesystem path string', async () => {
    vi.stubEnv('TASKTWIN_API_BASE_URL', 'http://127.0.0.1:4555');
    const loadEnvironment = vi
      .spyOn(process, 'loadEnvFile')
      .mockImplementation(() => undefined);

    const { getControlPlaneOrigin } = await import('@/lib/server/environment');

    expect(getControlPlaneOrigin()).toBe('http://127.0.0.1:4555');
    expect(loadEnvironment).toHaveBeenCalledOnce();
    expect(typeof loadEnvironment.mock.calls[0]?.[0]).toBe('string');
  }, 15_000);

  it('rejects configured origins containing credentials or paths', async () => {
    vi.stubEnv(
      'TASKTWIN_API_BASE_URL',
      'https://user:password@example.test/control-plane',
    );
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    const { getControlPlaneOrigin } = await import('@/lib/server/environment');

    expect(() => getControlPlaneOrigin()).toThrow(
      'TASKTWIN_API_BASE_URL must be an HTTP(S) origin without credentials.',
    );
  });

  it('requires an explicit API origin in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TASKTWIN_API_BASE_URL', undefined);
    const { getControlPlaneOrigin } = await import('@/lib/server/environment');

    expect(() => getControlPlaneOrigin()).toThrow(
      'TASKTWIN_API_BASE_URL is required in production.',
    );
  });

  it('requires explicit approval for an internal HTTP origin in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TASKTWIN_API_BASE_URL', 'http://api:3001');
    const { getControlPlaneOrigin } = await import('@/lib/server/environment');
    expect(() => getControlPlaneOrigin()).toThrow(
      'TASKTWIN_API_BASE_URL must use HTTPS unless internal HTTP is explicitly allowed.',
    );

    vi.stubEnv('TASKTWIN_ALLOW_HTTP_INTERNAL_API', 'true');
    expect(getControlPlaneOrigin()).toBe('http://api:3001');
  });
});
