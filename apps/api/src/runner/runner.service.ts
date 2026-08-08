import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, createPublicKey } from 'node:crypto';
import {
  RunnerRepository,
  RunnerRepositoryError,
  SecureRunInputRepository,
  SecureRunInputRepositoryError,
  type RunnerDeviceRecord,
  RunnerSecretInventoryRepository,
  RunnerSecretInventoryRepositoryError,
} from '@tasktwin/database';
import {
  LocalSecretInventorySyncRequestSchema,
  LocalSecretInventorySyncResponseSchema,
} from '@tasktwin/local-secret-store';
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
import {
  RunnerEncryptionKeyRegistrationRequestSchema,
  RunnerEncryptionKeyRegistrationResponseSchema,
} from '@tasktwin/secure-run-inputs';

import type { AuthenticatedRunner } from '../runner-auth/runner-authenticated-request.js';

function safeDevice(record: RunnerDeviceRecord, now: Date) {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    metadata: record.metadata,
    capabilities: record.capabilities,
    connectionStatus: deriveRunnerConnectionStatus({
      lastSeenAt: record.lastSeenAt?.toISOString() ?? null,
      revokedAt: record.revokedAt?.toISOString() ?? null,
      now: now.toISOString(),
      offlineAfterSeconds: RUNNER_OFFLINE_AFTER_SECONDS,
    }),
    lastSeenAt: record.lastSeenAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    runtime: record.runtime,
    localSecretStore:
      record.localSecretStore === null
        ? null
        : {
            ...record.localSecretStore,
            lastSynchronizedAt:
              record.localSecretStore.lastSynchronizedAt?.toISOString() ?? null,
          },
  };
}

@Injectable()
export class RunnerService {
  constructor(
    private readonly repository: RunnerRepository,
    private readonly secureInputs?: SecureRunInputRepository,
    private readonly secretInventories?: RunnerSecretInventoryRepository,
  ) {}

  async synchronizeSecretInventory(
    runner: AuthenticatedRunner,
    input: unknown,
  ) {
    const request = LocalSecretInventorySyncRequestSchema.safeParse(input);
    if (!request.success || this.secretInventories === undefined) {
      throw new BadRequestException({
        code: 'LOCAL_SECRET_INVENTORY_INVALID',
        message: 'The local secret inventory is invalid.',
      });
    }
    try {
      const result = await this.secretInventories.synchronize({
        runnerDeviceId: runner.runnerDeviceId,
        workspaceId: runner.workspaceId,
        request: request.data,
      });
      return LocalSecretInventorySyncResponseSchema.parse({
        schemaVersion: 1,
        idempotent: result.idempotent,
        vaultId: result.inventory.vaultId,
        vaultRevision: result.inventory.vaultRevision,
        inventoryDigest: result.inventory.inventoryDigest,
        storeStatus: result.inventory.storeStatus,
        synchronizedAt: result.inventory.lastSynchronizedAt.toISOString(),
      });
    } catch (error: unknown) {
      if (error instanceof RunnerSecretInventoryRepositoryError) {
        if (
          error.code === 'RUNNER_UNAVAILABLE'
        ) {
          throw new ForbiddenException({ code: error.code });
        }
        throw new ConflictException({
          code: error.code,
          message: 'The local secret inventory conflicts with trusted state.',
        });
      }
      throw error;
    }
  }

  async heartbeat(
    runner: AuthenticatedRunner,
    input: unknown,
  ): Promise<RunnerHeartbeatResponse> {
    const request = RunnerHeartbeatRequestSchema.safeParse(input);
    if (!request.success) {
      throw new ForbiddenException();
    }
    try {
      const runtime = await this.repository.heartbeat({
        ...runner,
        runnerVersion: request.data.runnerVersion,
        capabilities: request.data.capabilities,
        ...(request.data.runtime === undefined ? {} : { runtime: request.data.runtime }),
        now: new Date(),
      });
      return RunnerHeartbeatResponseSchema.parse({
        schemaVersion: 1,
        runnerDeviceId: runner.runnerDeviceId,
        workspaceId: runner.workspaceId,
        connectionStatus: 'online',
        capabilities: request.data.capabilities,
        ...(runtime === null ? {} : { runtime }),
        nextHeartbeatInSeconds: DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
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
  }

  async registerEncryptionKey(runner: AuthenticatedRunner, input: unknown) {
    const request =
      RunnerEncryptionKeyRegistrationRequestSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException('Invalid Runner encryption key.');
    }
    try {
      const der = Buffer.from(request.data.key.publicKeySpki, 'base64url');
      const publicKey = createPublicKey({
        key: der,
        format: 'der',
        type: 'spki',
      });
      const details = publicKey.asymmetricKeyDetails;
      const fingerprint = createHash('sha256').update(der).digest('hex');
      if (
        publicKey.asymmetricKeyType !== 'rsa' ||
        details?.modulusLength !== 3_072 ||
        details.publicExponent !== 65_537n ||
        fingerprint !== request.data.key.fingerprint
      ) {
        throw new BadRequestException('Invalid Runner encryption key.');
      }
      if (this.secureInputs === undefined) {
        throw new ConflictException(
          'Secure input registration is unavailable.',
        );
      }
      const result = await this.secureInputs.registerRunnerKey({
        runnerDeviceId: runner.runnerDeviceId,
        key: request.data.key,
      });
      return RunnerEncryptionKeyRegistrationResponseSchema.parse({
        schemaVersion: 1,
        ...result,
      });
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof SecureRunInputRepositoryError) {
        if (error.code === 'RUNNER_UNAVAILABLE') {
          throw new ForbiddenException();
        }
        throw new ConflictException({
          code: error.code,
          message: 'The Runner encryption key conflicts with current state.',
        });
      }
      throw new BadRequestException('Invalid Runner encryption key.');
    }
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
