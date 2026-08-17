import type {
  WorkspaceExecutionPolicyDefinition,
  WorkflowPolicyEvaluation,
} from '@tasktwin/workflow-policy';

interface PolicyDigestPanelProps {
  policy: WorkspaceExecutionPolicyDefinition;
  evaluation: WorkflowPolicyEvaluation | null;
}

function describePattern(
  pattern: WorkspaceExecutionPolicyDefinition['network']['allowedOrigins'][number],
): string {
  if (pattern.kind === 'exact') {
    return pattern.origin;
  }
  const apexNote = pattern.includeApex ? ' (and apex)' : '';
  return `https://*.${pattern.domain}${apexNote}`;
}

function formatOriginList(
  origins: WorkspaceExecutionPolicyDefinition['network']['allowedOrigins'],
): string {
  if (origins.length === 0) return '—';
  return origins.map((origin) => describePattern(origin)).join(', ');
}

function describeRiskLevel(risk: string): string {
  if (risk === 'low') return 'Low';
  if (risk === 'medium') return 'Medium';
  if (risk === 'high') return 'High';
  return 'Critical';
}

function describeApprovalThreshold(threshold: string): string {
  return threshold === 'critical_only'
    ? 'High and Critical only'
    : 'Critical only';
}

export function PolicyDigestPanel({
  policy,
  evaluation,
}: PolicyDigestPanelProps) {
  const blockingSteps = (evaluation?.steps ?? []).filter((step) =>
    step.issues.some((issue) => issue.severity === 'blocking'),
  );
  const warningSteps = (evaluation?.steps ?? []).filter((step) =>
    step.issues.some((issue) => issue.severity === 'warning'),
  );
  return (
    <section
      className={`readiness-panel ${
        blockingSteps.length === 0 ? 'readiness-ready' : 'readiness-blocked'
      }`}
      aria-labelledby="policy-digest-heading"
    >
      <h2 id="policy-digest-heading">Execution policy digest</h2>
      <p>
        Every run is evaluated against the active Workspace execution policy.
        Blocking findings deny execution; warning findings need an explicit
        Approval step. The policy itself never carries secret values.
      </p>
      <dl className="policy-digest-grid">
        <div>
          <dt>Network mode</dt>
          <dd>{policy.network.mode.replaceAll('_', ' ')}</dd>
        </div>
        <div>
          <dt>Allowed origins</dt>
          <dd>{formatOriginList(policy.network.allowedOrigins)}</dd>
        </div>
        <div>
          <dt>Loopback HTTP</dt>
          <dd>{policy.network.allowLoopbackHttp ? 'Allowed' : 'Denied'}</dd>
        </div>
        <div>
          <dt>Unknown-action risk</dt>
          <dd>{describeRiskLevel(policy.unknownActionRisk)}</dd>
        </div>
        <div>
          <dt>Approval threshold</dt>
          <dd>{describeApprovalThreshold(policy.approval.threshold)}</dd>
        </div>
        <div>
          <dt>Custom rules</dt>
          <dd>{policy.rules.length}</dd>
        </div>
      </dl>
      {evaluation !== null ? (
        <p className="metadata">
          Evaluated {evaluation.steps.length} step
          {evaluation.steps.length === 1 ? '' : 's'}. Overall decision:{' '}
          <strong>{evaluation.overallDecision}</strong>. {blockingSteps.length}{' '}
          blocking, {warningSteps.length} warning.
          {evaluation.hasBlockingIssues
            ? ' Deny wins: resolve blocking issues before publishing.'
            : ''}
        </p>
      ) : (
        <p className="metadata">
          Policy evaluation waits for the definition to be valid.
        </p>
      )}
    </section>
  );
}