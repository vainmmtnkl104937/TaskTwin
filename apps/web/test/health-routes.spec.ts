import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET as getLiveness } from '@/app/health/live/route';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('web health routes', () => {
  it('keeps liveness independent from the API', async () => {
    const response = getLiveness();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'alive' });
  });

  it('reports readiness using safe stable codes', async () => {
    vi.stubEnv('TASKTWIN_API_BASE_URL', 'http://127.0.0.1:3001');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );
    const { GET } = await import('@/app/health/ready/route');
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ready',
      checks: [{ code: 'CONTROL_PLANE_API_READY', status: 'pass' }],
    });
  });

  it('returns a safe 503 when the API is unavailable', async () => {
    vi.stubEnv('TASKTWIN_API_BASE_URL', 'http://127.0.0.1:3001');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('private detail')),
    );
    const { GET } = await import('@/app/health/ready/route');
    const response = await GET();
    expect(response.status).toBe(503);
    const body = JSON.stringify(await response.json());
    expect(body).toContain('CONTROL_PLANE_API_UNAVAILABLE');
    expect(body).not.toContain('private detail');
  });
});
