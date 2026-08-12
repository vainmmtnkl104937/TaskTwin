import { z } from 'zod';
import { RunnerComplianceStatusSchema } from '@tasktwin/runner-rollout';
import {
  RunnerRuntimeMetadataSchema,
  RunnerRuntimeReportSchema,
} from '@tasktwin/runner-service-runtime';
import {
  RunnerCapabilitySchema as SecureInputRunnerCapabilitySchema,
  RunnerEncryptionKeyRegistrationRequestSchema,
  RunnerEncryptionKeyRegistrationResponseSchema,
  RunnerPublicKeyMetadataSchema,
} from '@tasktwin/secure-run-inputs';
import {
  LocalSecretAliasSchema,
  LocalSecretStoreStatusSchema,
} from '@tasktwin/local-secret-store';
import {
  ProductSemVerSchema,
  RunnerCompatibilityEvaluationSchema,
  RunnerCompatibilityStatusSchema,
  RunnerSoftwareIdentitySchema,
} from '@tasktwin/runner-release';

import {
  DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
  LOCATOR_REPAIR_PROPOSALS_CAPABILITY,
  LOCAL_SECRET_STORE_CAPABILITY,
  OS_NATIVE_SECRET_UNLOCK_CAPABILITY,
  MAX_POLL_INTERVAL_SECONDS,
  OPAQUE_CODE_PATTERN,
  RUNNER_PROTOCOL_SCHEMA_VERSION,
  RUNNER_SERVICE_CAPABILITY,
  USER_CODE_PATTERN,
  WORKFLOW_APPROVAL_CAPABILITY,
  WORKFLOW_EXTRACTION_CAPABILITY,
  WORKFLOW_MANUAL_REPAIR_CAPABILITY,
  WORKFLOW_SCHEDULED_EXECUTION_CAPABILITY,
  WORKFLOW_VERIFICATION_CAPABILITY,
} from './constants.js';

const UuidSchema = z.string().uuid();
const IsoDateSchema = z.string().datetime({ offset: true });
const OpaqueCodeSchema = z.string().regex(OPAQUE_CODE_PATTERN);
const UserCodeSchema = z.string().regex(USER_CODE_PATTERN);

export const RunnerCapabilitySchema = z.union([
  SecureInputRunnerCapabilitySchema,
  z.literal(WORKFLOW_VERIFICATION_CAPABILITY),
  z.literal(WORKFLOW_EXTRACTION_CAPABILITY),
  z.literal(WORKFLOW_APPROVAL_CAPABILITY),
  z.literal(WORKFLOW_MANUAL_REPAIR_CAPABILITY),
  z.literal(WORKFLOW_SCHEDULED_EXECUTION_CAPABILITY),
  z.literal(LOCATOR_REPAIR_PROPOSALS_CAPABILITY),
  z.literal(LOCAL_SECRET_STORE_CAPABILITY),
  z.literal(RUNNER_SERVICE_CAPABILITY),
  z.literal(OS_NATIVE_SECRET_UNLOCK_CAPABILITY),
]);
export const RunnerCapabilitiesSchema = z
  .array(RunnerCapabilitySchema)
  .max(11)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: 'custom',
        message: 'Capabilities must be unique.',
      });
    }
  });

export {
  RunnerEncryptionKeyRegistrationRequestSchema,
  RunnerEncryptionKeyRegistrationResponseSchema,
  RunnerPublicKeyMetadataSchema,
};

export const ControlPlaneOriginSchema = z
  .string()
  .max(512)
  .superRefine((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Control Plane origin is invalid.',
      });
      return;
    }
    const loopback =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1';
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== '' ||
      url.origin !== value ||
      (url.protocol !== 'https:' && !loopback)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Control Plane origin is invalid.',
      });
    }
  });

export const RunnerPlatformSchema = z.enum(['win32', 'darwin', 'linux']);
export const RunnerArchitectureSchema = z.enum(['x64', 'arm64']);
export const RunnerVersionSchema = ProductSemVerSchema;

export const RunnerDeviceMetadataSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(100),
  platform: RunnerPlatformSchema,
  architecture: RunnerArchitectureSchema,
  runnerVersion: RunnerVersionSchema,
  installationId: UuidSchema,
});

export const PairingStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'DENIED',
  'CONSUMED',
  'EXPIRED',
]);

export const RunnerConnectionStatusSchema = z.enum([
  'online',
  'offline',
  'revoked',
]);

export const PairingSessionCreateRequestSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
  metadata: RunnerDeviceMetadataSchema,
});

export const PairingSessionCreateResponseSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
  userCode: UserCodeSchema,
  deviceCode: OpaqueCodeSchema,
  verificationUri: z.string().url().max(512),
  expiresInSeconds: z.number().int().positive().max(3_600),
  intervalSeconds: z.number().int().positive().max(MAX_POLL_INTERVAL_SECONDS),
});

export const PairingTokenRequestSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
  deviceCode: OpaqueCodeSchema,
});

const PollIntervalSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_POLL_INTERVAL_SECONDS);

export const PairingPollingResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({
    schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
    status: z.literal('authorization_pending'),
    intervalSeconds: PollIntervalSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
    status: z.literal('slow_down'),
    intervalSeconds: PollIntervalSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
    status: z.literal('access_denied'),
  }),
  z.strictObject({
    schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
    status: z.literal('expired'),
  }),
  z.strictObject({
    schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
    status: z.literal('paired'),
    runnerDeviceId: UuidSchema,
    workspaceId: UuidSchema,
    credential: OpaqueCodeSchema,
    heartbeatIntervalSeconds: z.number().int().positive().max(300),
  }),
]);

export const PairingCodeRequestSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
  userCode: UserCodeSchema,
});

export const PairingApprovalRequestSchema = PairingCodeRequestSchema;
export const PairingDenialRequestSchema = PairingCodeRequestSchema.extend({
  workspaceId: UuidSchema,
});

export const PairingInspectionResponseSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
  pairingSessionId: UuidSchema,
  status: PairingStatusSchema,
  metadata: RunnerDeviceMetadataSchema,
  expiresAt: IsoDateSchema,
});

export const PairingActionResponseSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
  pairingSessionId: UuidSchema,
  workspaceId: UuidSchema,
  status: PairingStatusSchema,
});

export const OrganizationRoleSchema = z.enum([
  'OWNER',
  'ADMIN',
  'MEMBER',
  'VIEWER',
]);

export const SafeRunnerDeviceSchema = z.strictObject({
  id: UuidSchema,
  workspaceId: UuidSchema,
  metadata: RunnerDeviceMetadataSchema,
  capabilities: RunnerCapabilitiesSchema,
  connectionStatus: RunnerConnectionStatusSchema,
  lastSeenAt: IsoDateSchema.nullable(),
  revokedAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
  softwareIdentity: RunnerSoftwareIdentitySchema.nullable().optional(),
  compatibility: RunnerCompatibilityEvaluationSchema.optional(),
  desiredVersion: RunnerVersionSchema.nullable().optional(),
  complianceStatus: RunnerComplianceStatusSchema.optional(),
  localSecretStore: z
    .strictObject({
      status: LocalSecretStoreStatusSchema,
      vaultRevision: z.number().int().positive().nullable(),
      configuredSecretCount: z.number().int().nonnegative().max(1_000),
      lastSynchronizedAt: IsoDateSchema.nullable(),
      aliases: z
        .array(
          z.strictObject({
            alias: LocalSecretAliasSchema,
            secretVersionId: UuidSchema,
          }),
        )
        .max(1_000),
    })
    .nullable()
    .optional(),
  runtime: RunnerRuntimeMetadataSchema.nullable().optional(),
});

export const RunnerDeviceListResponseSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
  workspaceId: UuidSchema,
  access: z.strictObject({
    role: OrganizationRoleSchema,
    canManage: z.boolean(),
  }),
  devices: z.array(SafeRunnerDeviceSchema).max(100),
  nextCursor: z.string().max(512).nullable(),
});

export const RunnerDeviceRevokeResponseSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
  device: SafeRunnerDeviceSchema,
});

export const RunnerHeartbeatRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
    runnerVersion: RunnerVersionSchema,
    softwareIdentity: RunnerSoftwareIdentitySchema.optional(),
    capabilities: RunnerCapabilitiesSchema.default([]),
    runtime: RunnerRuntimeReportSchema.optional(),
  })
  .superRefine((request, context) => {
    if (
      request.softwareIdentity !== undefined &&
      request.softwareIdentity.version !== request.runnerVersion
    ) {
      context.addIssue({
        code: 'custom',
        path: ['softwareIdentity', 'version'],
        message: 'Software identity version must match runnerVersion.',
      });
    }
  });

export const RunnerHeartbeatResponseSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
  runnerDeviceId: UuidSchema,
  workspaceId: UuidSchema,
  connectionStatus: z.literal('online'),
  capabilities: RunnerCapabilitiesSchema,
  runtime: RunnerRuntimeMetadataSchema.optional(),
  nextHeartbeatInSeconds: z
    .number()
    .int()
    .positive()
    .max(300)
    .default(DEFAULT_HEARTBEAT_INTERVAL_SECONDS),
});

/**
 * Optional heartbeat response-header acknowledgement. Keeping this outside
 * the strict response body lets already-deployed Runners continue parsing the
 * Session 17/31 heartbeat response unchanged.
 */
export const RunnerCompatibilityAcknowledgementSchema =
  RunnerCompatibilityStatusSchema;
export const RunnerDesiredVersionAcknowledgementSchema = RunnerVersionSchema;
export const RunnerComplianceAcknowledgementSchema =
  RunnerComplianceStatusSchema;

export const RunnerAuthorizationPartsSchema = z.strictObject({
  runnerDeviceId: UuidSchema,
  credential: OpaqueCodeSchema,
});

export const SafeRunnerProtocolErrorSchema = z.strictObject({
  code: z.enum([
    'INVALID_REQUEST',
    'PAIRING_UNAVAILABLE',
    'PAIRING_CONFLICT',
    'RUNNER_UNAUTHORIZED',
    'RUNNER_REVOKED',
    'STORAGE_UNAVAILABLE',
    'REMOTE_UNAVAILABLE',
  ]),
  message: z.string().trim().min(1).max(200),
});

export const StoredRunnerCredentialSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_PROTOCOL_SCHEMA_VERSION),
  controlPlaneOrigin: ControlPlaneOriginSchema,
  runnerDeviceId: UuidSchema,
  workspaceId: UuidSchema,
  installationId: UuidSchema,
  credential: OpaqueCodeSchema,
  savedAt: IsoDateSchema,
});

export type RunnerDeviceMetadata = z.infer<typeof RunnerDeviceMetadataSchema>;
export type RunnerCapability = z.infer<typeof RunnerCapabilitySchema>;
export type PairingStatus = z.infer<typeof PairingStatusSchema>;
export type RunnerConnectionStatus = z.infer<
  typeof RunnerConnectionStatusSchema
>;
export type PairingSessionCreateRequest = z.infer<
  typeof PairingSessionCreateRequestSchema
>;
export type PairingSessionCreateResponse = z.infer<
  typeof PairingSessionCreateResponseSchema
>;
export type PairingTokenRequest = z.infer<typeof PairingTokenRequestSchema>;
export type PairingPollingResponse = z.infer<
  typeof PairingPollingResponseSchema
>;
export type PairingCodeRequest = z.infer<typeof PairingCodeRequestSchema>;
export type PairingDenialRequest = z.infer<typeof PairingDenialRequestSchema>;
export type PairingInspectionResponse = z.infer<
  typeof PairingInspectionResponseSchema
>;
export type PairingActionResponse = z.infer<typeof PairingActionResponseSchema>;
export type SafeRunnerDevice = z.infer<typeof SafeRunnerDeviceSchema>;
export type RunnerDeviceListResponse = z.infer<
  typeof RunnerDeviceListResponseSchema
>;
export type RunnerDeviceRevokeResponse = z.infer<
  typeof RunnerDeviceRevokeResponseSchema
>;
export type RunnerHeartbeatRequest = z.infer<
  typeof RunnerHeartbeatRequestSchema
>;
export type RunnerHeartbeatResponse = z.infer<
  typeof RunnerHeartbeatResponseSchema
>;
export type RunnerDesiredVersionAcknowledgement = z.infer<
  typeof RunnerDesiredVersionAcknowledgementSchema
>;
export type RunnerComplianceAcknowledgement = z.infer<
  typeof RunnerComplianceAcknowledgementSchema
>;
export type RunnerCompatibilityAcknowledgement = z.infer<
  typeof RunnerCompatibilityAcknowledgementSchema
>;
export type RunnerAuthorizationParts = z.infer<
  typeof RunnerAuthorizationPartsSchema
>;
export type StoredRunnerCredential = z.infer<
  typeof StoredRunnerCredentialSchema
>;
