import type { PublishReadinessReport } from '@tasktwin/workflow-lifecycle';

export function PublishReadinessPanel({
  report,
}: {
  report: PublishReadinessReport;
}) {
  return (
    <section
      className={`readiness-panel ${report.ready ? 'readiness-ready' : 'readiness-blocked'}`}
      aria-labelledby="publish-readiness-heading"
    >
      <h2 id="publish-readiness-heading">Publish readiness</h2>
      <p>
        {report.ready
          ? 'This definition passes deterministic publish checks.'
          : 'Resolve every blocking issue before Testing or Publish.'}
      </p>
      {report.issues.length === 0 ? null : (
        <ul>
          {report.issues.map((issue, index) => (
            <li key={`${issue.code}-${issue.path.join('.')}-${index}`}>
              <strong>
                {issue.severity === 'blocking' ? 'Blocking' : 'Warning'}:
              </strong>{' '}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
