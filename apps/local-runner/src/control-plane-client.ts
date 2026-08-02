import {
  PairingPollingResponseSchema,
  PairingSessionCreateResponseSchema,
  RunnerHeartbeatResponseSchema,
  type PairingPollingResponse,
  type PairingSessionCreateRequest,
  type PairingSessionCreateResponse,
  type RunnerHeartbeatResponse,
  type StoredRunnerCredential,
  type RunnerCapability,
} from '@tasktwin/runner-protocol';
import {
  RunnerEncryptionKeyRegistrationResponseSchema,
  type RunnerEncryptionKeyRegistrationRequest,
  type RunnerEncryptionKeyRegistrationResponse,
} from '@tasktwin/secure-run-inputs';
import {
  LeaseRenewalResponseSchema,
  RunnerJobClaimResponseSchema,
  WorkflowProgressBatchResponseSchema,
  WorkflowRunCompletionResponseSchema,
  type LeaseRenewalResponse,
  type RunnerJobClaimRequest,
  type RunnerJobClaimResponse,
  type WorkflowProgressBatch,
  type WorkflowRunCompletionRequest,
  type WorkflowRunCompletionResponse,
} from '@tasktwin/run-protocol';
import {
  RunnerApprovalRequestCreatedSchema,
  RunnerApprovalStatusSchema,
  type RunnerApprovalRequestCreate,
  type RunnerApprovalRequestCreated,
  type RunnerApprovalStatus,
} from '@tasktwin/workflow-approval';
import {
  RunnerRepairRequestCreatedSchema,
  RunnerRepairStatusSchema,
  type RunnerRepairRequestCreate,
  type RunnerRepairRequestCreated,
  type RunnerRepairStatus,
} from '@tasktwin/workflow-recovery';

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
    capabilities?: RunnerCapability[],
  ): Promise<RunnerHeartbeatResponse>;
  registerEncryptionKey(
    credential: StoredRunnerCredential,
    request: RunnerEncryptionKeyRegistrationRequest,
  ): Promise<RunnerEncryptionKeyRegistrationResponse>;
}

export interface RunnerJobTransport {
  claimJob(
    credential: StoredRunnerCredential,
    request: RunnerJobClaimRequest,
  ): Promise<RunnerJobClaimResponse>;
  renewJobLease(
    credential: StoredRunnerCredential,
    runId: string,
    leaseToken: string,
  ): Promise<LeaseRenewalResponse>;
  sendProgress(
    credential: StoredRunnerCredential,
    runId: string,
    leaseToken: string,
    batch: WorkflowProgressBatch,
  ): Promise<{ acceptedThroughSequence: number; cancelRequested: boolean }>;
  completeJob(
    credential: StoredRunnerCredential,
    runId: string,
    leaseToken: string,
    completion: WorkflowRunCompletionRequest,
  ): Promise<WorkflowRunCompletionResponse>;
  createApprovalRequest(
    credential: StoredRunnerCredential,
    runId: string,
    leaseToken: string,
    request: RunnerApprovalRequestCreate,
  ): Promise<RunnerApprovalRequestCreated>;
  getApprovalStatus(
    credential: StoredRunnerCredential,
    runId: string,
    leaseToken: string,
    approvalRequestId: string,
  ): Promise<RunnerApprovalStatus>;
  createRepairRequest?(
    credential: StoredRunnerCredential,
    runId: string,
    leaseToken: string,
    request: RunnerRepairRequestCreate,
  ): Promise<RunnerRepairRequestCreated>;
  getRepairStatus?(
    credential: StoredRunnerCredential,
    runId: string,
    leaseToken: string,
    repairRequestId: string,
  ): Promise<RunnerRepairStatus>;
}

export class HttpRunnerControlPlaneTransport
  implements RunnerControlPlaneTransport, RunnerJobTransport
{
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
    capabilities: RunnerCapability[] = [],
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
        body: JSON.stringify({ schemaVersion: 1, runnerVersion, capabilities }),
      },
    );
  }

  registerEncryptionKey(
    credential: StoredRunnerCredential,
    request: RunnerEncryptionKeyRegistrationRequest,
  ): Promise<RunnerEncryptionKeyRegistrationResponse> {
    return this.request(
      `${credential.controlPlaneOrigin}/runner/encryption-keys`,
      RunnerEncryptionKeyRegistrationResponseSchema,
      {
        method: 'POST',
        headers: this.runnerHeaders(credential),
        body: JSON.stringify(request),
      },
    );
  }

  claimJob(
    credential: StoredRunnerCredential,
    request: RunnerJobClaimRequest,
  ): Promise<RunnerJobClaimResponse> {
    return this.request(
      `${credential.controlPlaneOrigin}/runner/jobs/claim`,
      RunnerJobClaimResponseSchema,
      {
        method: 'POST',
        headers: this.runnerHeaders(credential),
        body: JSON.stringify(request),
      },
    );
  }

  renewJobLease(
    credential: StoredRunnerCredential,
    runId: string,
    leaseToken: string,
  ): Promise<LeaseRenewalResponse> {
    return this.request(
      `${credential.controlPlaneOrigin}/runner/jobs/${encodeURIComponent(runId)}/lease/renew`,
      LeaseRenewalResponseSchema,
      {
        method: 'POST',
        headers: this.runnerHeaders(credential, leaseToken),
        body: JSON.stringify({ schemaVersion: 1 }),
      },
    );
  }

  async sendProgress(
    credential: StoredRunnerCredential,
    runId: string,
    leaseToken: string,
    batch: WorkflowProgressBatch,
  ): Promise<{ acceptedThroughSequence: number; cancelRequested: boolean }> {
    const response = await this.request(
      `${credential.controlPlaneOrigin}/runner/jobs/${encodeURIComponent(runId)}/progress`,
      WorkflowProgressBatchResponseSchema,
      {
        method: 'POST',
        headers: this.runnerHeaders(credential, leaseToken),
        body: JSON.stringify(batch),
      },
    );
    return {
      acceptedThroughSequence: response.acceptedThroughSequence,
      cancelRequested: response.cancelRequested,
    };
  }

  createApprovalRequest(
    credential: StoredRunnerCredential,
    runId: string,
    leaseToken: string,
    request: RunnerApprovalRequestCreate,
  ): Promise<RunnerApprovalRequestCreated> {
    return this.request(
      `${credential.controlPlaneOrigin}/runner/jobs/${encodeURIComponent(runId)}/approval-requests`,
      RunnerApprovalRequestCreatedSchema,
      {
        method: 'POST',
        headers: this.runnerHeaders(credential, leaseToken),
        body: JSON.stringify(request),
      },
    );
  }

  getApprovalStatus(
    credential: StoredRunnerCredential,
    runId: string,
    leaseToken: string,
    approvalRequestId: string,
  ): Promise<RunnerApprovalStatus> {
    return this.request(
      `${credential.controlPlaneOrigin}/runner/jobs/${encodeURIComponent(runId)}/approval-requests/${encodeURIComponent(approvalRequestId)}`,
      RunnerApprovalStatusSchema,
      {
        method: 'GET',
        headers: this.runnerHeaders(credential, leaseToken),
      },
    );
  }

  createRepairRequest(
    credential: StoredRunnerCredential,
    runId: string,
    leaseToken: string,
    request: RunnerRepairRequestCreate,
  ): Promise<RunnerRepairRequestCreated> {
    return this.request(
      `${credential.controlPlaneOrigin}/runner/jobs/${encodeURIComponent(runId)}/repair-requests`,
      RunnerRepairRequestCreatedSchema,
      {
        method: 'POST',
        headers: this.runnerHeaders(credential, leaseToken),
        body: JSON.stringify(request),
      },
    );
  }

  getRepairStatus(
    credential: StoredRunnerCredential,
    runId: string,
    leaseToken: string,
    repairRequestId: string,
  ): Promise<RunnerRepairStatus> {
    return this.request(
      `${credential.controlPlaneOrigin}/runner/jobs/${encodeURIComponent(runId)}/repair-requests/${encodeURIComponent(repairRequestId)}`,
      RunnerRepairStatusSchema,
      {
        method: 'GET',
        headers: this.runnerHeaders(credential, leaseToken),
      },
    );
  }

  completeJob(
    credential: StoredRunnerCredential,
    runId: string,
    leaseToken: string,
    completion: WorkflowRunCompletionRequest,
  ): Promise<WorkflowRunCompletionResponse> {
    return this.request(
      `${credential.controlPlaneOrigin}/runner/jobs/${encodeURIComponent(runId)}/complete`,
      WorkflowRunCompletionResponseSchema,
      {
        method: 'POST',
        headers: this.runnerHeaders(credential, leaseToken),
        body: JSON.stringify(completion),
      },
    );
  }

  private runnerHeaders(
    credential: StoredRunnerCredential,
    leaseToken?: string,
  ): Record<string, string> {
    return {
      authorization: `TaskTwinRunner ${credential.runnerDeviceId}.${credential.credential}`,
      'content-type': 'application/json',
      ...(leaseToken === undefined
        ? {}
        : { 'x-tasktwin-run-lease': leaseToken }),
    };
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
