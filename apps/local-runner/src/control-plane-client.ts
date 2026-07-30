import {
  PairingPollingResponseSchema,
  PairingSessionCreateResponseSchema,
  RunnerHeartbeatResponseSchema,
  type PairingPollingResponse,
  type PairingSessionCreateRequest,
  type PairingSessionCreateResponse,
  type RunnerHeartbeatResponse,
  type StoredRunnerCredential,
} from '@tasktwin/runner-protocol';

const MAX_RESPONSE_BYTES = 64 * 1024;

export class ControlPlaneClientError extends Error {
  constructor(readonly status: number | null) {
    super('The Control Plane request failed.');
    this.name = 'ControlPlaneClientError';
  }
}

export interface RunnerControlPlaneTransport {
  createPairingSession(
    origin: string,
    request: PairingSessionCreateRequest,
  ): Promise<PairingSessionCreateResponse>;
  pollPairing(
    origin: string,
    deviceCode: string,
  ): Promise<PairingPollingResponse>;
  heartbeat(
    credential: StoredRunnerCredential,
    runnerVersion: string,
  ): Promise<RunnerHeartbeatResponse>;
}

export class HttpRunnerControlPlaneTransport implements RunnerControlPlaneTransport {
  createPairingSession(
    origin: string,
    request: PairingSessionCreateRequest,
  ): Promise<PairingSessionCreateResponse> {
    return this.request(
      `${origin}/runner-pairing/sessions`,
      PairingSessionCreateResponseSchema,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      },
    );
  }

  pollPairing(
    origin: string,
    deviceCode: string,
  ): Promise<PairingPollingResponse> {
    return this.request(
      `${origin}/runner-pairing/token`,
      PairingPollingResponseSchema,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, deviceCode }),
      },
    );
  }

  heartbeat(
    credential: StoredRunnerCredential,
    runnerVersion: string,
  ): Promise<RunnerHeartbeatResponse> {
    return this.request(
      `${credential.controlPlaneOrigin}/runner/heartbeat`,
      RunnerHeartbeatResponseSchema,
      {
        method: 'POST',
        headers: {
          authorization: `TaskTwinRunner ${credential.runnerDeviceId}.${credential.credential}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ schemaVersion: 1, runnerVersion }),
      },
    );
  }

  private async request<Result>(
    url: string,
    schema: { safeParse(input: unknown): { success: boolean; data?: Result } },
    init: RequestInit,
  ): Promise<Result> {
    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ControlPlaneClientError(null);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new ControlPlaneClientError(response.status);
    }
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new ControlPlaneClientError(response.status);
    }
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new ControlPlaneClientError(response.status);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success || parsed.data === undefined) {
      throw new ControlPlaneClientError(response.status);
    }
    return parsed.data;
  }
}
