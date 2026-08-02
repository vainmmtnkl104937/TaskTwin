import {
  normalizeAllowedOrigins,
  validateNavigationUrl,
} from '@tasktwin/workflow-engine';
import {
  analyzeWorkflowInputs,
  validateWorkflowRunInputs,
} from '@tasktwin/workflow-inputs';
import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
} from '@tasktwin/workflow-schema';
import { analyzeWorkflowVerifications } from '@tasktwin/workflow-verification';
import { analyzeWorkflowExtraction } from '@tasktwin/workflow-extraction';

import { RUN_PROTOCOL_SCHEMA_VERSION } from './constants.js';
import {
  WorkflowRunReadinessReportSchema,
  type WorkflowRunReadinessReport,
} from './contracts.js';

const SUPPORTED_STEPS = new Set([
  'navigate',
  'click',
  'fill',
  'select',
  'setChecked',
  'wait',
  'verify',
  'extract',
]);

function issue(
  code: WorkflowRunReadinessReport['issues'][number]['code'],
  message: string,
  step?: { id: string; index: number },
) {
  return {
    code,
    message,
    ...(step === undefined ? {} : { stepId: step.id, stepIndex: step.index }),
  };
}

export function analyzeWorkflowRunReadiness(
  input: unknown,
): WorkflowRunReadinessReport {
  const parsed = WorkflowDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return WorkflowRunReadinessReportSchema.parse({
      schemaVersion: RUN_PROTOCOL_SCHEMA_VERSION,
      ready: false,
      allowedOrigins: [],
      issues: [
        issue(
          'INVALID_WORKFLOW_DEFINITION',
          'The workflow definition is invalid.',
        ),
      ],
    });
  }
  const workflow: WorkflowDefinition = parsed.data;
  const issues: WorkflowRunReadinessReport['issues'] = [];
  const origins: string[] = [];

  if (workflow.status !== 'published') {
    issues.push(
      issue(
        'WORKFLOW_VERSION_NOT_PUBLISHED',
        'Only a published workflow version can run.',
      ),
    );
  }

  const analysis = analyzeWorkflowInputs(workflow);
  if (analysis.hasBlockingIssues) {
    issues.push(
      issue(
        'INVALID_WORKFLOW_DEFINITION',
        'The workflow has invalid input references.',
      ),
    );
  }
  if (analyzeWorkflowVerifications(workflow).issues.length > 0) {
    issues.push(
      issue(
        'INVALID_WORKFLOW_DEFINITION',
        'The workflow contains an invalid verification rule.',
      ),
    );
  }
  if (analyzeWorkflowExtraction(workflow).hasBlockingIssues) {
    issues.push(
      issue(
        'INVALID_WORKFLOW_DEFINITION',
        'The workflow contains an invalid output data flow.',
      ),
    );
  }
  if (analysis.variables.some((item) => item.usageCount > 0)) {
    issues.push(
      issue(
        'RUNTIME_INPUT_REQUIRED',
        'Runtime variable delivery is unavailable.',
      ),
    );
  }
  if (analysis.secretRequirements.length > 0) {
    issues.push(
      issue(
        'SECRET_RESOLUTION_UNAVAILABLE',
        'Secret resolution is unavailable.',
      ),
    );
  }
  if (
    analysis.variables.some(
      (item) =>
        item.variable.valueType === 'file' &&
        (item.variable.required || item.usageCount > 0),
    )
  ) {
    issues.push(
      issue('FILE_INPUT_UNAVAILABLE', 'File input delivery is unavailable.'),
    );
  }
  const emptyInputs = validateWorkflowRunInputs(workflow, {
    schemaVersion: 1,
    values: {},
  });
  if (!emptyInputs.summary.valid) {
    issues.push(
      issue(
        'RUNTIME_INPUT_REQUIRED',
        'The workflow requires runtime input delivery.',
      ),
    );
  }

  if (workflow.steps[0]?.type !== 'navigate') {
    issues.push(
      issue(
        'FIRST_STEP_MUST_NAVIGATE',
        'The first executable step must be Navigate.',
      ),
    );
  }

  workflow.steps.forEach((step, index) => {
    if (!SUPPORTED_STEPS.has(step.type)) {
      issues.push(
        issue(
          'UNSUPPORTED_STEP_TYPE',
          'The workflow contains an unsupported execution step.',
          { id: step.id, index },
        ),
      );
      return;
    }
    if (step.type !== 'navigate') {
      return;
    }
    if (step.url.kind !== 'literal' || typeof step.url.value !== 'string') {
      issues.push(
        issue(
          'NAVIGATION_URL_MUST_BE_LITERAL',
          'Navigate requires a literal URL for persisted dispatch.',
          { id: step.id, index },
        ),
      );
      return;
    }
    try {
      const url = new URL(step.url.value);
      const normalized = normalizeAllowedOrigins([url.origin]);
      validateNavigationUrl(step.url.value, normalized);
      origins.push(normalized[0]!);
    } catch {
      issues.push(
        issue(
          'INVALID_NAVIGATION_URL',
          'Navigate contains an unsafe or invalid URL.',
          { id: step.id, index },
        ),
      );
    }
  });

  const allowedOrigins = [...new Set(origins)];
  if (allowedOrigins.length === 0) {
    issues.push(
      issue(
        'NO_ALLOWED_ORIGIN',
        'The workflow does not provide a safe allowed origin.',
      ),
    );
  }

  const uniqueIssues = issues.filter(
    (item, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.code === item.code &&
          candidate.stepId === item.stepId &&
          candidate.stepIndex === item.stepIndex,
      ) === index,
  );
  return WorkflowRunReadinessReportSchema.parse({
    schemaVersion: RUN_PROTOCOL_SCHEMA_VERSION,
    ready: uniqueIssues.length === 0,
    allowedOrigins,
    issues: uniqueIssues,
  });
}
