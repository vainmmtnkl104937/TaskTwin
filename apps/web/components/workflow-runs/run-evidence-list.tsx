'use client';

import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import { loadRunEvidenceAction } from '@/app/(authenticated)/workspaces/[workspaceId]/runs/actions';
import type { RunEvidenceResponse } from '@/lib/control-plane-contracts';

interface RunEvidenceListProps {
  workflowRunId: string;
}

export function RunEvidenceList({
  workflowRunId,
}: RunEvidenceListProps): JSX.Element {
  const [evidence, setEvidence] = useState<RunEvidenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const result = await loadRunEvidenceAction({ workflowRunId });
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setEvidence(result.evidence);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      }
    }
    void load();
    return (): void => {
      cancelled = true;
    };
  }, [workflowRunId]);

  if (error !== null) {
    return (
      <section className="error-banner" role="alert">
        <p>
          <strong>Evidence could not be loaded.</strong> The Control Plane
          returned an error. The message below is safe to share when you open
          a support ticket; it never contains secret values, recorded URLs or
          any text typed on a recorded page.
        </p>
        <p className="metadata">{error}</p>
      </section>
    );
  }
  if (evidence === null) {
    return (
      <p className="metadata" aria-busy="true">
        Loading evidence…
      </p>
    );
  }
  if (evidence.events.length === 0) {
    return (
      <p className="empty-state">
        No audit events were recorded for this run. The full list is also
        visible from the workspace Audit page filtered on this run.
      </p>
    );
  }
  return (
    <ol aria-label="Audit evidence for run" className="evidence-list">
      {evidence.events.map((event) => (
        <li key={event.id} className="metadata">
          <span className="ev-seq">#{event.sequence}</span>
          <span className="ev-type">{event.eventType}</span>
          <span className="ev-when">{event.occurredAt}</span>
        </li>
      ))}
    </ol>
  );
}