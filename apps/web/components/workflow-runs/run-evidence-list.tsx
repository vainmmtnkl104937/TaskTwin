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
    return <p role="alert">{error}</p>;
  }
  if (evidence === null) {
    return <p>Loading evidence...</p>;
  }
  if (evidence.events.length === 0) {
    return <p>No audit events were recorded for this run.</p>;
  }
  return (
    <ol aria-label="Audit evidence for run">
      {evidence.events.map((event) => (
        <li key={event.id} className="metadata">
          #{event.sequence} · {event.eventType} · {event.occurredAt}
        </li>
      ))}
    </ol>
  );
}