import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  RunnerRepository,
  RunnerRepositoryError,
  type RunnerDeviceRecord,
} from '@tasktwin/database';
import {
  DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
  RUNNER_OFFLINE_AFTER_SECONDS,
  RunnerDeviceListResponseSchema,
  RunnerDeviceRevokeResponseSchema,
  RunnerHeartbeatRequestSchema,
  RunnerHeartbeatResponseSchema,
  deriveRunnerConnectionStatus,
  type RunnerDeviceListResponse,
  type RunnerDeviceRevokeResponse,
  type RunnerHeartbeatResponse,
} from '@tasktwin/runner-protocol';

import type { AuthenticatedRunner } from '../runner-auth/runner-authenticated-request.js';

function safeDevice(record: RunnerDeviceRecord, now: Date) {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    metadata: record.metadata,
    connectionStatus: deriveRunnerConnectionStatus({
      lastSeenAt: record.lastSeenAt?.toISOString() ?? null,
      revokedAt: record.revokedAt?.toISOString() ?? null,
      now: now.toISOString(),
      offlineAfterSeconds: RUNNER_OFFLINE_AFTER_SECONDS,
    }),
    lastSeenAt: record.lastSeenAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

@Injectable()
export class RunnerService {
  constructor(private readonly repository: RunnerRepository) {}

  async heartbeat(
    runner: AuthenticatedRunner,
    input: unknown,
  ): Promise<RunnerHeartbeatResponse> {
    const request = RunnerHeartbeatRequestSchema.safeParse(input);
    if (!request.success) {
      throw new ForbiddenException();
    }
    try {
      await this.repository.heartbeat({
        ...runner,
        runnerVersion: request.data.runnerVersion,
        now: new Date(),
      });
    } catch (error: unknown) {
      if (
        error instanceof RunnerRepositoryError &&
        error.code === 'RUNNER_REVOKED'
      ) {
        throw new ForbiddenException();
      }
      throw error;
    }
    return RunnerHeartbeatResponseSchema.parse({
      schemaVersion: 1,
      runnerDeviceId: runner.runnerDeviceId,
      workspaceId: runner.workspaceId,
      connectionStatus: 'online',
      nextHeartbeatInSeconds: DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    });
  }

  async listDevices(
    actorUserId: string,
    workspaceId: string,
  ): Promise<RunnerDeviceListResponse> {
    const result = await this.repository.listRunnerDevices(
      actorUserId,
      workspaceId,
    );
    if (result === null) {
      throw new NotFoundException();
    }
    const now = new Date();
    return RunnerDeviceListResponseSchema.parse({
      schemaVersion: 1,
      workspaceId,
      access: {
        role: result.access.role,
        canManage:
          result.access.role === 'OWNER' || result.access.role === 'ADMIN',
      },
      devices: result.devices.map((device) => safeDevice(device, now)),
    });
  }

  async revoke(
    actorUserId: string,
    runnerDeviceId: string,
  ): Promise<RunnerDeviceRevokeResponse> {
    try {
      const record = await this.repository.revokeRunnerDevice(
        actorUserId,
        runnerDeviceId,
        new Date(),
      );
      return RunnerDeviceRevokeResponseSchema.parse({
        schemaVersion: 1,
        device: safeDevice(record, new Date()),
      });
    } catch (error: unknown) {
      if (error instanceof RunnerRepositoryError) {
        if (error.code === 'RUNNER_FORBIDDEN') {
          throw new ForbiddenException();
        }
        if (
          error.code === 'RUNNER_DEVICE_NOT_FOUND' ||
          error.code === 'WORKSPACE_NOT_FOUND'
        ) {
          throw new NotFoundException();
        }
      }
      throw error;
    }
  }
}
