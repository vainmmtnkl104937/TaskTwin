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
  });

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
});
