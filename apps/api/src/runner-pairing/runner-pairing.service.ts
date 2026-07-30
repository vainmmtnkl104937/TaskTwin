import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  RunnerRepository,
  RunnerRepositoryError,
  type RunnerPairingRecord,
} from '@tasktwin/database';
import {
  DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
  DEFAULT_PAIRING_EXPIRES_IN_SECONDS,
  DEFAULT_POLL_INTERVAL_SECONDS,
  PairingActionResponseSchema,
  PairingApprovalRequestSchema,
  PairingCodeRequestSchema,
  PairingDenialRequestSchema,
  PairingInspectionResponseSchema,
  PairingPollingResponseSchema,
  PairingSessionCreateRequestSchema,
  PairingSessionCreateResponseSchema,
  PairingTokenRequestSchema,
  type PairingActionResponse,
  type PairingInspectionResponse,
  type PairingPollingResponse,
  type PairingSessionCreateResponse,
} from '@tasktwin/runner-protocol';

import { PairingCryptoService } from './pairing-crypto.service.js';

const CODE_GENERATION_ATTEMPTS = 5;

function rethrowRepositoryError(error: unknown): never {
  if (!(error instanceof RunnerRepositoryError)) {
    throw error;
  }
  switch (error.code) {
    case 'PAIRING_UNAVAILABLE':
    case 'WORKSPACE_NOT_FOUND':
    case 'RUNNER_DEVICE_NOT_FOUND':
      throw new NotFoundException('Pairing session is unavailable.');
    case 'PAIRING_CONFLICT':
      throw new ConflictException('Pairing session is unavailable.');
    case 'RUNNER_FORBIDDEN':
      throw new ForbiddenException();
    case 'PAIRING_CODE_COLLISION':
    case 'SERIALIZATION_FAILURE':
      throw new ServiceUnavailableException(
        'Pairing is temporarily unavailable.',
      );
    case 'RUNNER_REVOKED':
      throw new ForbiddenException();
  }
}

function actionResponse(record: RunnerPairingRecord): PairingActionResponse {
  if (record.workspaceId === null) {
    throw new Error('A pairing action must have a workspace.');
  }
  return PairingActionResponseSchema.parse({
    schemaVersion: 1,
    pairingSessionId: record.id,
    workspaceId: record.workspaceId,
    status: record.status,
  });
}

@Injectable()
export class RunnerPairingService {
  constructor(
    private readonly runnerRepository: RunnerRepository,
    private readonly crypto: PairingCryptoService,
  ) {}

  async create(input: unknown): Promise<PairingSessionCreateResponse> {
    const request = PairingSessionCreateRequestSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException('Invalid pairing request.');
    }
    for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const userCode = this.crypto.generateUserCode();
      const deviceCode = this.crypto.generateDeviceCode();
      try {
        await this.runnerRepository.createPairingSession({
          id: randomUUID(),
          userCodeDigest: this.crypto.hashUserCode(userCode),
          deviceCodeHash: this.crypto.hashDeviceCode(deviceCode),
          metadata: request.data.metadata,
          expiresAt: new Date(
            Date.now() + DEFAULT_PAIRING_EXPIRES_IN_SECONDS * 1_000,
          ),
          pollIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
        });
        return PairingSessionCreateResponseSchema.parse({
          schemaVersion: 1,
          userCode,
          deviceCode,
          verificationUri: this.crypto.getVerificationUri(),
          expiresInSeconds: DEFAULT_PAIRING_EXPIRES_IN_SECONDS,
          intervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
        });
      } catch (error: unknown) {
        if (
          error instanceof RunnerRepositoryError &&
          error.code === 'PAIRING_CODE_COLLISION'
        ) {
          continue;
        }
        rethrowRepositoryError(error);
      }
    }
    throw new ServiceUnavailableException(
      'Pairing is temporarily unavailable.',
    );
  }

  async poll(input: unknown): Promise<PairingPollingResponse> {
    const request = PairingTokenRequestSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException('Invalid pairing request.');
    }
    const deviceCodeHash = this.crypto.hashDeviceCode(request.data.deviceCode);
    const pairingSessionId =
      await this.runnerRepository.findPairingIdByDeviceCodeHash(deviceCodeHash);
    if (pairingSessionId === null) {
      return PairingPollingResponseSchema.parse({
        schemaVersion: 1,
        status: 'expired',
      });
    }
    const credential = this.crypto.deriveCredential(
      pairingSessionId,
      request.data.deviceCode,
    );
    try {
      const result = await this.runnerRepository.pollPairing({
        deviceCodeHash,
        runnerDeviceId: randomUUID(),
        credentialId: randomUUID(),
        credentialHash: this.crypto.hashCredential(credential),
        now: new Date(),
      });
      return PairingPollingResponseSchema.parse(
        result.status === 'paired'
          ? {
              schemaVersion: 1,
              status: 'paired',
              runnerDeviceId: result.runnerDeviceId,
              workspaceId: result.workspaceId,
              credential,
              heartbeatIntervalSeconds: DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
            }
          : { schemaVersion: 1, ...result },
      );
    } catch (error: unknown) {
      rethrowRepositoryError(error);
    }
  }

  async inspect(
    actorUserId: string,
    input: unknown,
  ): Promise<PairingInspectionResponse> {
    const request = this.parseCodeRequest(input, PairingCodeRequestSchema);
    const record = await this.runnerRepository.inspectPairing(
      actorUserId,
      this.crypto.hashUserCode(request.userCode),
      new Date(),
    );
    if (record === null) {
      throw new NotFoundException('Pairing session is unavailable.');
    }
    return PairingInspectionResponseSchema.parse({
      schemaVersion: 1,
      pairingSessionId: record.id,
      status: record.status,
      metadata: record.metadata,
      expiresAt: record.expiresAt.toISOString(),
    });
  }

  async approve(
    actorUserId: string,
    workspaceId: string,
    input: unknown,
  ): Promise<PairingActionResponse> {
    const request = this.parseCodeRequest(input, PairingApprovalRequestSchema);
    try {
      return actionResponse(
        await this.runnerRepository.approvePairing(
          actorUserId,
          workspaceId,
          this.crypto.hashUserCode(request.userCode),
          new Date(),
        ),
      );
    } catch (error: unknown) {
      rethrowRepositoryError(error);
    }
  }

  async deny(
    actorUserId: string,
    input: unknown,
  ): Promise<PairingActionResponse> {
    if (typeof input !== 'object' || input === null) {
      throw new BadRequestException('Invalid pairing request.');
    }
    const normalized = this.crypto.normalizeUserCode(
      'userCode' in input ? input.userCode : undefined,
    );
    const request = PairingDenialRequestSchema.safeParse({
      ...input,
      userCode: normalized,
    });
    if (!request.success) {
      throw new BadRequestException('Invalid pairing request.');
    }
    try {
      return actionResponse(
        await this.runnerRepository.denyPairing(
          actorUserId,
          request.data.workspaceId,
          this.crypto.hashUserCode(request.data.userCode),
          new Date(),
        ),
      );
    } catch (error: unknown) {
      rethrowRepositoryError(error);
    }
  }

  private parseCodeRequest(
    input: unknown,
    schema: typeof PairingCodeRequestSchema,
  ): { schemaVersion: 1; userCode: string } {
    if (typeof input !== 'object' || input === null) {
      throw new BadRequestException('Invalid pairing request.');
    }
    const normalized = this.crypto.normalizeUserCode(
      'userCode' in input ? input.userCode : undefined,
    );
    const parsed = schema.safeParse({ ...input, userCode: normalized });
    if (!parsed.success) {
      throw new BadRequestException('Invalid pairing request.');
    }
    return parsed.data;
  }
}
