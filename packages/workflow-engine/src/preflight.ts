import {
  analyzeWorkflowInputs,
  validateWorkflowRunInputs,
  WorkflowRunInputSubmissionSchema,
  type RuntimeInputValue,
} from '@tasktwin/workflow-inputs';
import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
} from '@tasktwin/workflow-schema';
import { z } from 'zod';

import type { WorkflowExecutionAdapter } from './adapter.js';
import {
  AllowedOriginSchema,
  WorkflowEngineExecutionOptionsSchema,
  WorkflowExecutionRequestSchema,
  type SafeExecutionError,
  type WorkflowExecutionRequest,
} from './contracts.js';
import {
  MAX_ALLOWED_ORIGINS,
  WORKFLOW_ENGINE_SCHEMA_VERSION,
} from './constants.js';
import { SafeExecutionException, safeError, toSafeError } from './errors.js';
import {
  normalizeAllowedOrigins,
  validateNavigationUrl,
} from './origin-policy.js';
import {
  resolveSelectValue,
  resolveTextValue,
} from './value-source-resolver.js';

const RawExecutionEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_ENGINE_SCHEMA_VERSION),
  workflow: z.unknown(),
  inputs: z.unknown(),
  allowedOrigins: z.unknown(),
  options: z.unknown(),
});

const AllowedOriginsSchema = z
  .array(AllowedOriginSchema)
  .min(1)
  .max(MAX_ALLOWED_ORIGINS);

export interface PreparedWorkflowExecution {
  request: WorkflowExecutionRequest;
  runtimeInputs: Readonly<Record<string, RuntimeInputValue>>;
  allowedOrigins: readonly string[];
}

export type PreflightResult =
  | {
      ok: true;
      prepared: PreparedWorkflowExecution;
    }
  | {
      ok: false;
      error: SafeExecutionError;
      workflow?: WorkflowDefinition;
    };

function failure(
  code: SafeExecutionError['code'],
  workflow?: WorkflowDefinition,
): PreflightResult {
  return {
    ok: false,
    error: safeError(code),
    ...(workflow === undefined ? {} : { workflow }),
  };
}

export function findTypedWorkflow(
  input: unknown,
): WorkflowDefinition | undefined {
  if (typeof input !== 'object' || input === null || !('workflow' in input)) {
    return undefined;
  }
  const parsed = WorkflowDefinitionSchema.safeParse(input.workflow);
  return parsed.success ? parsed.data : undefined;
}

export function preflightWorkflowExecution(
  input: unknown,
  adapter: WorkflowExecutionAdapter,
): PreflightResult {
  const envelope = RawExecutionEnvelopeSchema.safeParse(input);
  if (!envelope.success) {
    return failure('INVALID_EXECUTION_REQUEST', findTypedWorkflow(input));
  }

  const workflowResult = WorkflowDefinitionSchema.safeParse(
    envelope.data.workflow,
  );
  if (!workflowResult.success) {
    return failure('INVALID_WORKFLOW');
  }
  const workflow = workflowResult.data;

  const options = WorkflowEngineExecutionOptionsSchema.safeParse(
    envelope.data.options,
  );
  if (!options.success) {
    return failure('INVALID_EXECUTION_TIMEOUT', workflow);
  }

  const submittedInputs = WorkflowRunInputSubmissionSchema.safeParse(
    envelope.data.inputs,
  );
  if (!submittedInputs.success) {
    return failure('INVALID_RUNTIME_INPUTS', workflow);
  }

  const inputAnalysis = analyzeWorkflowInputs(workflow);
  if (inputAnalysis.hasBlockingIssues) {
    return failure('INVALID_WORKFLOW', workflow);
  }
  if (inputAnalysis.secretRequirements.length > 0) {
    return failure('SECRET_RESOLUTION_UNAVAILABLE', workflow);
  }
  const inputValidation = validateWorkflowRunInputs(
    workflow,
    submittedInputs.data,
  );
  if (!inputValidation.summary.valid) {
    return failure('INVALID_RUNTIME_INPUTS', workflow);
  }

  const originInput = AllowedOriginsSchema.safeParse(
    envelope.data.allowedOrigins,
  );
  if (!originInput.success) {
    return failure('INVALID_EXECUTION_REQUEST', workflow);
  }

  let allowedOrigins: readonly string[];
  try {
    allowedOrigins = normalizeAllowedOrigins(originInput.data);
  } catch (error: unknown) {
    return {
      ok: false,
      error: toSafeError(error, 'INVALID_EXECUTION_REQUEST'),
      workflow,
    };
  }

  const runtimeInputs = Object.freeze({ ...submittedInputs.data.values });
  const supported = new Set(adapter.supportedStepTypes);
  try {
    for (const step of workflow.steps) {
      if (!supported.has(step.type)) {
        throw new SafeExecutionException('UNSUPPORTED_STEP_TYPE');
      }
      adapter.validateStep(step);
      if (step.type === 'navigate') {
        validateNavigationUrl(
          resolveTextValue(step.url, 'navigate.url', runtimeInputs),
          allowedOrigins,
        );
      } else if (step.type === 'fill') {
        resolveTextValue(step.value, 'fill.value', runtimeInputs);
      } else if (step.type === 'select') {
        resolveSelectValue(step.value, runtimeInputs);
      }
    }
  } catch (error: unknown) {
    return {
      ok: false,
      error: toSafeError(error, 'INVALID_WORKFLOW'),
      workflow,
    };
  }

  const request = WorkflowExecutionRequestSchema.parse({
    schemaVersion: WORKFLOW_ENGINE_SCHEMA_VERSION,
    workflow,
    inputs: submittedInputs.data,
    allowedOrigins: originInput.data,
    options: options.data,
  });
  return {
    ok: true,
    prepared: {
      request,
      runtimeInputs,
      allowedOrigins,
    },
  };
}
