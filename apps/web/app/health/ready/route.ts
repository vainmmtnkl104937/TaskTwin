import {
  getControlPlaneOrigin,
  getWebReadinessTimeoutMs,
} from '@/lib/server/environment';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const response = await fetch(`${getControlPlaneOrigin()}/health/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(getWebReadinessTimeoutMs()),
    });
    if (!response.ok) throw new Error('API_NOT_READY');
    return Response.json({
      status: 'ready',
      checks: [{ code: 'CONTROL_PLANE_API_READY', status: 'pass' }],
    });
  } catch {
    return Response.json(
      {
        status: 'not_ready',
        checks: [{ code: 'CONTROL_PLANE_API_UNAVAILABLE', status: 'fail' }],
      },
      { status: 503 },
    );
  }
}
