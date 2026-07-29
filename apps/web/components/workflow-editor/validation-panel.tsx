import type { WorkflowEditorIssue } from '@tasktwin/workflow-editor-core';

export function ValidationPanel({ issues }: { issues: WorkflowEditorIssue[] }) {
  return (
    <section className="validation-panel" aria-labelledby="validation-heading">
      <h2 id="validation-heading">Validation</h2>
      {issues.length === 0 ? (
        <p className="success-message">Workflow definition is valid.</p>
      ) : (
        <ul>
          {issues.map((issue, index) => (
            <li key={`${issue.code}:${issue.path.join('.')}:${index}`}>
              {issue.stepId === undefined ? '' : `${issue.stepId}: `}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
