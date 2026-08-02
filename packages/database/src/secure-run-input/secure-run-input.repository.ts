import { createHash, randomUUID } from 'node:crypto';

import {
  DEFAULT_RUN_STEP_TIMEOUT_MS,
  DEFAULT_RUN_TOTAL_TIMEOUT_MS,
  RUN_PROTOCOL_VERSION,
  analyzeWorkflowRunReadiness,
} from '@tasktwin/run-protocol';
import {
  DEFAULT_PREPARATION_TTL_SECONDS,
  SECURE_INPUT_CAPABILITIES,
  RunnerPublicKeyMetadataSchema,
  RunInputAdditionalAuthenticatedDataSchema,
  SecureExecutionOptionsSchema,
  SecureRunInputEnvelopeSchema,
  SecureRunInputManifestSchema,
  assertEnvelopeBinding,
  deriveSecureRunInputManifest,
  encodeRunInputAad,
  type RunnerPublicKeyMetadata,
  type SecureRunInputEnvelope,
} from '@tasktwin/secure-run-inputs';
import {
  WORKFLOW_EXTRACTION_CAPABILITY,
  WORKFLOW_APPROVAL_CAPABILITY,
  WORKFLOW_MANUAL_REPAIR_CAPABILITY,
  WORKFLOW_VERIFICATION_CAPABILITY,
} from '@tasktwin/runner-protocol';
import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';
import { defineWorkflowOutputs } from '@tasktwin/workflow-extraction';

import {
  OrganizationRole,
  Prisma,
  RunnerEncryptionKeyStatus,
  WorkflowRunInputPreparationStatus,
  WorkflowRunOutputType,
  type PrismaClient,
} from '../generated/prisma/client.js';
import { createCanonicalJsonDigest } from '../recording/canonical-json.js';
import { SecureRunInputRepositoryError } from './secure-run-input-errors.js';
import type {
  RunInputCommitResult,
  RunInputPreparationResult,
  RunnerEncryptionKeyRegistrationResult,
} from './secure-run-input-records.js';

const WRITER_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
] as const;
const SERIALIZATION_RETRY_COUNT = 3;

function isSerializationError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' || error.code === 'P2028')
  );
}

function keyMetadata(row: {
  keyId: string;
  profile: string;
  algorithm: string;
  publicKeySpki: string;
  fingerprint: string;
}): RunnerPublicKeyMetadata {
  return RunnerPublicKeyMetadataSchema.parse({
    schemaVersion: 1,
    keyId: row.keyId,
    profile: row.profile,
    algorithm: row.algorithm,
    publicKeyFormat: 'spki',
    publicKeySpki: row.publicKeySpki,
    fingerprint: row.fingerprint,
  });
}

function sha256Base64Url(value: string): string {
  return createHash('sha256')
    .update(Buffer.from(value, 'base64url'))
    .digest('hex');
}

export class SecureRunInputRepository {
  constructor(private readonly prisma: PrismaClient) {}

  registerRunnerKey(input: {
    runnerDeviceId: string;
    key: RunnerPublicKeyMetadata;
  }): Promise<RunnerEncryptionKeyRegistrationResult> {
    return this.serializable(async (transaction) => {
      const runner = await transaction.runnerDevice.findUnique({
        where: { id: input.runnerDeviceId },
        select: { revokedAt: true },
      });
      if (runner === null || runner.revokedAt !== null) {
        throw new SecureRunInputRepositoryError('RUNNER_UNAVAILABLE');
      }
      const existing = await transaction.runnerEncryptionKey.findUnique({
        where: {
          runnerDeviceId_keyId: {
            runnerDeviceId: input.runnerDeviceId,
            keyId: input.key.keyId,
          },
        },
      });
      if (existing !== null) {
        const persisted = keyMetadata(existing);
        if (
          createCanonicalJsonDigest(persisted) !==
          createCanonicalJsonDigest(input.key)
        ) {
          throw new SecureRunInputRepositoryError('KEY_CONFLICT');
        }
        return { key: persisted, idempotent: true };
      }
      const otherActive = await transaction.runnerEncryptionKey.findFirst({
        where: {
          runnerDeviceId: input.runnerDeviceId,
          status: RunnerEncryptionKeyStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (otherActive !== null) {
        throw new SecureRunInputRepositoryError('KEY_CONFLICT');
      }
      const created = await transaction.runnerEncryptionKey.create({
        data: {
          runnerDeviceId: input.runnerDeviceId,
          keyId: input.key.keyId,
          profile: input.key.profile,
          algorithm: input.key.algorithm,
          publicKeySpki: input.key.publicKeySpki,
          fingerprint: input.key.fingerprint,
        },
      });
      return { key: keyMetadata(created), idempotent: false };
    });
  }

  prepare(input: {
    actorUserId: string;
    workflowVersionId: string;
    runnerDeviceId: string;
    clientPreparationId: string;
    clientRunId: string;
    options?: { totalTimeoutMs: number; stepTimeoutMs: number };
    now: Date;
  }): Promise<RunInputPreparationResult> {
    return this.serializable(async (transaction) => {
      const version = await transaction.workflowVersion.findFirst({
        where: {
          id: input.workflowVersionId,
          workflow: {
            workspace: {
              organization: {
                members: { some: { userId: input.actorUserId } },
              },
            },
          },
        },
        select: {
          id: true,
          workflowId: true,
          version: true,
          status: true,
          schemaVersion: true,
          definition: true,
          workflow: { select: { workspaceId: true } },
        },
      });
      if (version === null) {
        throw new SecureRunInputRepositoryError('NOT_FOUND');
      }
      await this.requireWriter(
        transaction,
        input.actorUserId,
        version.workflow.workspaceId,
      );
      const requestDigest = createCanonicalJsonDigest({
        workflowVersionId: input.workflowVersionId,
        runnerDeviceId: input.runnerDeviceId,
        clientRunId: input.clientRunId,
        options: input.options ?? null,
      });
      const existing = await transaction.workflowRunInputPreparation.findUnique(
        {
          where: {
            workspaceId_clientPreparationId: {
              workspaceId: version.workflow.workspaceId,
              clientPreparationId: input.clientPreparationId,
            },
          },
          include: { runnerEncryptionKey: true },
        },
      );
      if (existing !== null) {
        if (existing.requestDigest !== requestDigest) {
          throw new SecureRunInputRepositoryError('PREPARATION_CONFLICT');
        }
        return this.preparationResult(existing, true);
      }
      const existingRunPreparation =
        await transaction.workflowRunInputPreparation.findUnique({
          where: {
            workspaceId_clientRunId: {
              workspaceId: version.workflow.workspaceId,
              clientRunId: input.clientRunId,
            },
          },
          select: { id: true },
        });
      if (existingRunPreparation !== null) {
        throw new SecureRunInputRepositoryError('PREPARATION_CONFLICT');
      }
      const parsed = WorkflowDefinitionSchema.safeParse(version.definition);
      if (
        !parsed.success ||
        version.status !== 'published' ||
        version.schemaVersion !== 1 ||
        parsed.data.workflowId !== version.workflowId ||
        parsed.data.version !== version.version ||
        parsed.data.status !== 'published'
      ) {
        throw new SecureRunInputRepositoryError('RUN_NOT_READY');
      }
      const readiness = analyzeWorkflowRunReadiness(parsed.data);
      const blockingIssues = readiness.issues.filter(
        (issue) =>
          issue.code !== 'RUNTIME_INPUT_REQUIRED' &&
          issue.code !== 'SECRET_RESOLUTION_UNAVAILABLE',
      );
      if (blockingIssues.length > 0) {
        throw new SecureRunInputRepositoryError('RUN_NOT_READY', {
          ...readiness,
          issues: blockingIssues,
        });
      }
      const manifest = deriveSecureRunInputManifest(parsed.data);
      const runner = await transaction.runnerDevice.findFirst({
        where: {
          id: input.runnerDeviceId,
          workspaceId: version.workflow.workspaceId,
        },
        include: {
          encryptionKeys: {
            where: { status: RunnerEncryptionKeyStatus.ACTIVE },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
      if (runner === null || runner.revokedAt !== null) {
        throw new SecureRunInputRepositoryError('RUNNER_UNAVAILABLE');
      }
      if (!runner.capabilities.includes(SECURE_INPUT_CAPABILITIES[0])) {
        throw new SecureRunInputRepositoryError('CAPABILITY_UNAVAILABLE');
      }
      if (
        parsed.data.steps.some((step) => step.type === 'verify') &&
        !runner.capabilities.includes(WORKFLOW_VERIFICATION_CAPABILITY)
      ) {
        throw new SecureRunInputRepositoryError('CAPABILITY_UNAVAILABLE');
      }
      if (
        parsed.data.steps.some((step) => step.type === 'extract') &&
        !runner.capabilities.includes(WORKFLOW_EXTRACTION_CAPABILITY)
      ) {
        throw new SecureRunInputRepositoryError('CAPABILITY_UNAVAILABLE');
      }
      if (
        parsed.data.steps.some((step) => step.type === 'approval') &&
        !runner.capabilities.includes(WORKFLOW_APPROVAL_CAPABILITY)
      ) {
        throw new SecureRunInputRepositoryError('CAPABILITY_UNAVAILABLE');
      }
      if (
        manifest.secrets.length > 0 &&
        !runner.capabilities.includes(SECURE_INPUT_CAPABILITIES[1])
      ) {
        throw new SecureRunInputRepositoryError('CAPABILITY_UNAVAILABLE');
      }
      const key = runner.encryptionKeys[0];
      if (key === undefined) {
        throw new SecureRunInputRepositoryError('CAPABILITY_UNAVAILABLE');
      }
      const options = SecureExecutionOptionsSchema.parse(
        input.options ?? {
          totalTimeoutMs: DEFAULT_RUN_TOTAL_TIMEOUT_MS,
          stepTimeoutMs: DEFAULT_RUN_STEP_TIMEOUT_MS,
          recoveryMode: 'automatic_safe_only',
        },
      );
      if (
        options.recoveryMode === 'automatic_safe_and_manual' &&
        !runner.capabilities.includes(WORKFLOW_MANUAL_REPAIR_CAPABILITY)
      ) {
        throw new SecureRunInputRepositoryError('CAPABILITY_UNAVAILABLE');
      }
      const preparationId = randomUUID();
      const workflowRunId = randomUUID();
      const expiresAt = new Date(
        input.now.getTime() + DEFAULT_PREPARATION_TTL_SECONDS * 1_000,
      );
      const aad = RunInputAdditionalAuthenticatedDataSchema.parse({
        schemaVersion: 1,
        profile: key.profile,
        preparationId,
        workflowRunId,
        workspaceId: version.workflow.workspaceId,
        workflowId: version.workflowId,
        workflowVersionId: version.id,
        workflowVersion: version.version,
        definitionDigest: createCanonicalJsonDigest(parsed.data),
        runnerDeviceId: runner.id,
        keyId: key.keyId,
        keyFingerprint: key.fingerprint,
        clientRunId: input.clientRunId,
        allowedOrigins: readiness.allowedOrigins,
        executionOptions: options,
        expiresAt: expiresAt.toISOString(),
      });
      const created = await transaction.workflowRunInputPreparation.create({
        data: {
          id: preparationId,
          workspaceId: version.workflow.workspaceId,
          workflowVersionId: version.id,
          runnerDeviceId: runner.id,
          runnerEncryptionKeyId: key.id,
          createdByUserId: input.actorUserId,
          clientPreparationId: input.clientPreparationId,
          clientRunId: input.clientRunId,
          reservedRunId: workflowRunId,
          variableManifest: manifest.variables,
          secretManifest: manifest.secrets,
          allowedOrigins: readiness.allowedOrigins,
          executionOptions: options,
          definitionDigest: aad.definitionDigest,
          aad,
          requestDigest,
          expiresAt,
        },
        include: { runnerEncryptionKey: true },
      });
      return this.preparationResult(created, false);
    });
  }

  commit(input: {
    actorUserId: string;
    preparationId: string;
    envelope: SecureRunInputEnvelope;
    now: Date;
  }): Promise<RunInputCommitResult> {
    return this.serializable(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "workflow_run_input_preparations"
        WHERE "id" = ${input.preparationId}::uuid FOR UPDATE
      `;
      const preparation =
        await transaction.workflowRunInputPreparation.findFirst({
          where: {
            id: input.preparationId,
            workspace: {
              organization: {
                members: { some: { userId: input.actorUserId } },
              },
            },
          },
          include: {
            workflowVersion: true,
            runnerDevice: true,
            runnerEncryptionKey: true,
            envelope: true,
          },
        });
      if (preparation === null) {
        throw new SecureRunInputRepositoryError('NOT_FOUND');
      }
      await this.requireWriter(
        transaction,
        input.actorUserId,
        preparation.workspaceId,
      );
      const envelope = SecureRunInputEnvelopeSchema.parse(input.envelope);
      if (preparation.status === WorkflowRunInputPreparationStatus.CONSUMED) {
        if (
          preparation.envelope?.ciphertextDigest !==
            envelope.ciphertextDigest ||
          preparation.envelope.aad !== envelope.aad
        ) {
          throw new SecureRunInputRepositoryError('PREPARATION_CONFLICT');
        }
        return { workflowRunId: preparation.reservedRunId, idempotent: true };
      }
      if (preparation.expiresAt.getTime() <= input.now.getTime()) {
        throw new SecureRunInputRepositoryError('PREPARATION_EXPIRED');
      }
      const aad = RunInputAdditionalAuthenticatedDataSchema.parse(
        preparation.aad,
      );
      try {
        assertEnvelopeBinding(envelope, aad, input.now);
      } catch {
        throw new SecureRunInputRepositoryError('ENVELOPE_INVALID');
      }
      if (
        envelope.aad !==
          Buffer.from(encodeRunInputAad(aad)).toString('base64url') ||
        sha256Base64Url(envelope.ciphertext) !== envelope.ciphertextDigest
      ) {
        throw new SecureRunInputRepositoryError('ENVELOPE_INVALID');
      }
      if (
        preparation.runnerDevice.revokedAt !== null ||
        preparation.runnerEncryptionKey.status !==
          RunnerEncryptionKeyStatus.ACTIVE ||
        preparation.workflowVersion.status !== 'published' ||
        preparation.definitionDigest !==
          createCanonicalJsonDigest(preparation.workflowVersion.definition)
      ) {
        throw new SecureRunInputRepositoryError('PREPARATION_CONFLICT');
      }
      const workflow = WorkflowDefinitionSchema.parse(
        preparation.workflowVersion.definition,
      );
      const outputDefinitions = defineWorkflowOutputs(workflow);
      await transaction.workflowRun.create({
        data: {
          id: preparation.reservedRunId,
          workspaceId: preparation.workspaceId,
          workflowId: preparation.workflowVersion.workflowId,
          workflowVersionId: preparation.workflowVersionId,
          runnerDeviceId: preparation.runnerDeviceId,
          createdByUserId: input.actorUserId,
          clientRunId: preparation.clientRunId,
          runProtocolVersion: RUN_PROTOCOL_VERSION,
          workflowEngineVersion: 1,
          definitionDigest: preparation.definitionDigest,
          allowedOrigins: preparation.allowedOrigins as Prisma.InputJsonValue,
          executionOptions:
            preparation.executionOptions as Prisma.InputJsonValue,
          steps: {
            create: workflow.steps.map((step, index) => ({
              sourceStepId: step.id,
              sourceStepIndex: index,
              stepType: step.type,
            })),
          },
          outputs: {
            create: outputDefinitions.map((output) => ({
              outputName: output.name,
              outputType:
                output.valueType === 'string'
                  ? WorkflowRunOutputType.STRING
                  : WorkflowRunOutputType.BOOLEAN,
              producerStepId: output.producerStepId,
              producerStepIndex: output.producerStepIndex,
            })),
          },
        },
      });
      await transaction.workflowRunInputEnvelope.create({
        data: {
          workflowRunId: preparation.reservedRunId,
          preparationId: preparation.id,
          runnerEncryptionKeyId: preparation.runnerEncryptionKeyId,
          schemaVersion: envelope.schemaVersion,
          profile: envelope.profile,
          contentEncryption: envelope.contentEncryption,
          keyEncryption: envelope.keyEncryption,
          keyId: envelope.keyId,
          expiresAt: new Date(envelope.expiresAt),
          aad: envelope.aad,
          iv: envelope.iv,
          wrappedKey: envelope.wrappedKey,
          ciphertext: envelope.ciphertext,
          ciphertextDigest: envelope.ciphertextDigest,
        },
      });
      await transaction.workflowRunInputPreparation.update({
        where: { id: preparation.id },
        data: {
          status: WorkflowRunInputPreparationStatus.CONSUMED,
          consumedAt: input.now,
        },
      });
      return { workflowRunId: preparation.reservedRunId, idempotent: false };
    });
  }

  private preparationResult(
    row: {
      id: string;
      clientPreparationId: string;
      clientRunId: string;
      reservedRunId: string;
      workspaceId: string;
      workflowVersionId: string;
      runnerDeviceId: string;
      expiresAt: Date;
      variableManifest: Prisma.JsonValue;
      secretManifest: Prisma.JsonValue;
      aad: Prisma.JsonValue;
      runnerEncryptionKey: {
        keyId: string;
        profile: string;
        algorithm: string;
        publicKeySpki: string;
        fingerprint: string;
      };
    },
    idempotent: boolean,
  ): RunInputPreparationResult {
    return {
      idempotent,
      preparation: {
        schemaVersion: 1,
        preparationId: row.id,
        clientPreparationId: row.clientPreparationId,
        clientRunId: row.clientRunId,
        workflowRunId: row.reservedRunId,
        workspaceId: row.workspaceId,
        workflowVersionId: row.workflowVersionId,
        runnerDeviceId: row.runnerDeviceId,
        expiresAt: row.expiresAt.toISOString(),
        manifest: SecureRunInputManifestSchema.parse({
          schemaVersion: 1,
          variables: row.variableManifest,
          secrets: row.secretManifest,
        }),
        key: keyMetadata(row.runnerEncryptionKey),
        aad: RunInputAdditionalAuthenticatedDataSchema.parse(row.aad),
      },
    };
  }

  private async requireWriter(
    transaction: Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const member = await transaction.organizationMember.findFirst({
      where: {
        userId,
        organization: { workspaces: { some: { id: workspaceId } } },
      },
      select: { role: true },
    });
    if (member === null) {
      throw new SecureRunInputRepositoryError('NOT_FOUND');
    }
    if (!WRITER_ROLES.includes(member.role as (typeof WRITER_ROLES)[number])) {
      throw new SecureRunInputRepositoryError('FORBIDDEN');
    }
  }

  private async serializable<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> {
    for (let attempt = 0; attempt < SERIALIZATION_RETRY_COUNT; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: unknown) {
        if (
          !isSerializationError(error) ||
          attempt === SERIALIZATION_RETRY_COUNT - 1
        ) {
          if (isSerializationError(error)) {
            throw new SecureRunInputRepositoryError('SERIALIZATION_FAILURE');
          }
          throw error;
        }
      }
    }
    throw new SecureRunInputRepositoryError('SERIALIZATION_FAILURE');
  }
}
