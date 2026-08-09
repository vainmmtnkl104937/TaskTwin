import { ReleaseManifestSchema } from '@tasktwin/runner-release';
import { z } from 'zod';

const PositiveVersionSchema = z.number().int().positive().max(2_147_483_647);

const UniquePositiveVersionsSchema = z
  .array(PositiveVersionSchema)
  .min(1)
  .superRefine((versions, context) => {
    if (new Set(versions).size !== versions.length) {
      context.addIssue({
        code: 'custom',
        message: 'Supported protocol versions must be unique.',
      });
    }
  });

export const RunnerInstallationCompatibilityDecisionSchema = z.enum([
  'compatible',
  'unsupported',
]);

export const RunnerInstallationCompatibilityReasonSchema = z.enum([
  'target_runner_protocol_unsupported',
  'source_runner_protocol_unsupported',
  'target_workflow_schema_unsupported',
  'source_workflow_schema_unsupported',
  'target_service_state_schema_unsupported',
  'source_service_state_schema_unsupported',
]);

export const RunnerInstallationCompatibilityInputSchema = z.strictObject({
  currentRelease: ReleaseManifestSchema,
  targetRelease: ReleaseManifestSchema,
  supportedRunnerProtocolVersions: UniquePositiveVersionsSchema,
  requiredWorkflowSchemaVersion: PositiveVersionSchema,
  currentServiceStateSchemaVersion: PositiveVersionSchema,
});

export const RunnerInstallationCompatibilityResultSchema = z
  .strictObject({
    decision: RunnerInstallationCompatibilityDecisionSchema,
    reasons: z.array(RunnerInstallationCompatibilityReasonSchema),
  })
  .superRefine((result, context) => {
    if (result.decision === 'compatible' && result.reasons.length !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'Compatible installation state cannot have failure reasons.',
        path: ['reasons'],
      });
    }
    if (result.decision === 'unsupported' && result.reasons.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Unsupported installation state requires a reason.',
        path: ['reasons'],
      });
    }
  });

export type RunnerInstallationCompatibilityInput = z.infer<
  typeof RunnerInstallationCompatibilityInputSchema
>;
export type RunnerInstallationCompatibilityDecision = z.infer<
  typeof RunnerInstallationCompatibilityDecisionSchema
>;
export type RunnerInstallationCompatibilityReason = z.infer<
  typeof RunnerInstallationCompatibilityReasonSchema
>;
export type RunnerInstallationCompatibilityResult = z.infer<
  typeof RunnerInstallationCompatibilityResultSchema
>;

function readsWorkflowSchema(
  manifest: z.infer<typeof ReleaseManifestSchema>,
  version: number,
): boolean {
  return (
    version >= manifest.compatibility.workflowSchema.readable.min &&
    version <= manifest.compatibility.workflowSchema.readable.max
  );
}

/**
 * Evaluates non-vault installation axes that are deliberately distinct from
 * product SemVer. Service state uses the signed local-state declaration because
 * Session 31 defines one aggregate local Runner-state schema version.
 */
export function evaluateRunnerInstallationCompatibility(
  rawInput: RunnerInstallationCompatibilityInput,
): RunnerInstallationCompatibilityResult {
  const input = RunnerInstallationCompatibilityInputSchema.parse(rawInput);
  const reasons: RunnerInstallationCompatibilityReason[] = [];
  if (
    !input.supportedRunnerProtocolVersions.includes(
      input.targetRelease.compatibility.runnerProtocolVersion,
    )
  ) {
    reasons.push('target_runner_protocol_unsupported');
  }
  if (
    !input.supportedRunnerProtocolVersions.includes(
      input.currentRelease.compatibility.runnerProtocolVersion,
    )
  ) {
    reasons.push('source_runner_protocol_unsupported');
  }
  if (
    !readsWorkflowSchema(
      input.targetRelease,
      input.requiredWorkflowSchemaVersion,
    )
  ) {
    reasons.push('target_workflow_schema_unsupported');
  }
  if (
    !readsWorkflowSchema(
      input.currentRelease,
      input.requiredWorkflowSchemaVersion,
    )
  ) {
    reasons.push('source_workflow_schema_unsupported');
  }
  if (
    !input.targetRelease.compatibility.localState.readableSchemas.includes(
      input.currentServiceStateSchemaVersion,
    )
  ) {
    reasons.push('target_service_state_schema_unsupported');
  }
  if (
    !input.currentRelease.compatibility.localState.readableSchemas.includes(
      input.targetRelease.compatibility.localState.writableSchema,
    )
  ) {
    reasons.push('source_service_state_schema_unsupported');
  }

  return RunnerInstallationCompatibilityResultSchema.parse({
    decision: reasons.length === 0 ? 'compatible' : 'unsupported',
    reasons,
  });
}
