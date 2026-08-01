import {
  RunInputAdditionalAuthenticatedDataSchema,
  type RunInputAdditionalAuthenticatedData,
} from './contracts.js';

export function canonicalRunInputAad(
  input: RunInputAdditionalAuthenticatedData,
): string {
  const value = RunInputAdditionalAuthenticatedDataSchema.parse(input);
  return JSON.stringify({
    schemaVersion: value.schemaVersion,
    profile: value.profile,
    preparationId: value.preparationId,
    workflowRunId: value.workflowRunId,
    workspaceId: value.workspaceId,
    workflowId: value.workflowId,
    workflowVersionId: value.workflowVersionId,
    workflowVersion: value.workflowVersion,
    definitionDigest: value.definitionDigest,
    runnerDeviceId: value.runnerDeviceId,
    keyId: value.keyId,
    keyFingerprint: value.keyFingerprint,
    clientRunId: value.clientRunId,
    allowedOrigins: value.allowedOrigins,
    executionOptions: {
      totalTimeoutMs: value.executionOptions.totalTimeoutMs,
      stepTimeoutMs: value.executionOptions.stepTimeoutMs,
    },
    expiresAt: value.expiresAt,
  });
}

export function encodeRunInputAad(
  input: RunInputAdditionalAuthenticatedData,
): Uint8Array {
  return new TextEncoder().encode(canonicalRunInputAad(input));
}
