import { createHash } from 'node:crypto';

import type { ClaimedRunnerJob } from '@tasktwin/run-protocol';
import {
  canonicalPolicyJson,
  evaluateWorkflowPolicy,
  serializeCanonicalJson,
  WorkflowPolicyEvaluationSchema,
} from '@tasktwin/workflow-policy';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalUnknown(value: unknown): string {
  return serializeCanonicalJson(
    JSON.parse(JSON.stringify(value)) as Parameters<
      typeof serializeCanonicalJson
    >[0],
  );
}

export function assertClaimedJobPolicy(job: ClaimedRunnerJob): void {
  const policyDigest = sha256(canonicalPolicyJson(job.policy.definition));
  const workflowJson = JSON.parse(JSON.stringify(job.workflow)) as Parameters<
    typeof serializeCanonicalJson
  >[0];
  const workflowDigest = sha256(serializeCanonicalJson(workflowJson));
  if (
    policyDigest !== job.policy.digest ||
    workflowDigest !== job.definitionDigest
  ) {
    throw new Error('Claimed job policy validation failed.');
  }
  const evaluation = evaluateWorkflowPolicy({
    policy: job.policy.definition,
    workflow: job.workflow,
    policyDigest,
    workflowDigest,
  });
  const supplied = WorkflowPolicyEvaluationSchema.parse(job.policy.evaluation);
  if (
    canonicalUnknown(evaluation) !== canonicalUnknown(supplied) ||
    evaluation.overallDecision === 'deny' ||
    evaluation.hasBlockingIssues
  ) {
    throw new Error('Claimed job policy validation failed.');
  }
}
