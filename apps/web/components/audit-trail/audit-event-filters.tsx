'use client';

import { useState } from 'react';
import type { JSX } from 'react';

interface AuditEventFiltersProps {
  initial: {
    eventTypes: string[];
    actorKinds: string[];
    primaryEntityKind: string;
    primaryEntityId: string;
    correlationId: string;
    fromOccurredAt: string;
    toOccurredAt: string;
    fromSequence: string;
    toSequence: string;
  };
  onApply: (filters: Record<string, string | string[]>) => void;
}

export function AuditEventFilters({
  initial,
  onApply,
}: AuditEventFiltersProps): JSX.Element {
  const [eventTypes, setEventTypes] = useState(initial.eventTypes.join(','));
  const [actorKinds, setActorKinds] = useState(initial.actorKinds.join(','));
  const [primaryEntityKind, setPrimaryEntityKind] = useState(initial.primaryEntityKind);
  const [primaryEntityId, setPrimaryEntityId] = useState(initial.primaryEntityId);
  const [correlationId, setCorrelationId] = useState(initial.correlationId);
  const [fromOccurredAt, setFromOccurredAt] = useState(initial.fromOccurredAt);
  const [toOccurredAt, setToOccurredAt] = useState(initial.toOccurredAt);
  const [fromSequence, setFromSequence] = useState(initial.fromSequence);
  const [toSequence, setToSequence] = useState(initial.toSequence);

  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next: Record<string, string | string[]> = {};
    const types = eventTypes.split(',').map((s) => s.trim()).filter(Boolean);
    if (types.length > 0) {
      next.eventTypes = types;
    }
    const kinds = actorKinds.split(',').map((s) => s.trim()).filter(Boolean);
    if (kinds.length > 0) {
      next.actorKinds = kinds;
    }
    if (primaryEntityKind) {
      next.primaryEntityKind = primaryEntityKind;
    }
    if (primaryEntityId) {
      next.primaryEntityId = primaryEntityId;
    }
    if (correlationId) {
      next.correlationId = correlationId;
    }
    if (fromOccurredAt) {
      next.fromOccurredAt = fromOccurredAt;
    }
    if (toOccurredAt) {
      next.toOccurredAt = toOccurredAt;
    }
    if (fromSequence) {
      next.fromSequence = fromSequence;
    }
    if (toSequence) {
      next.toSequence = toSequence;
    }
    onApply(next);
  }

  return (
    <form onSubmit={onSubmit}>
      <label>
        Event types (comma separated)
        <input value={eventTypes} onChange={(e) => setEventTypes(e.target.value)} />
      </label>
      <label>
        Actor kinds (comma separated)
        <input value={actorKinds} onChange={(e) => setActorKinds(e.target.value)} />
      </label>
      <label>
        Primary entity kind
        <input
          value={primaryEntityKind}
          onChange={(e) => setPrimaryEntityKind(e.target.value)}
        />
      </label>
      <label>
        Primary entity id
        <input
          value={primaryEntityId}
          onChange={(e) => setPrimaryEntityId(e.target.value)}
        />
      </label>
      <label>
        Correlation id
        <input
          value={correlationId}
          onChange={(e) => setCorrelationId(e.target.value)}
        />
      </label>
      <label>
        From occurred at
        <input
          value={fromOccurredAt}
          onChange={(e) => setFromOccurredAt(e.target.value)}
        />
      </label>
      <label>
        To occurred at
        <input
          value={toOccurredAt}
          onChange={(e) => setToOccurredAt(e.target.value)}
        />
      </label>
      <label>
        From sequence
        <input
          value={fromSequence}
          onChange={(e) => setFromSequence(e.target.value)}
        />
      </label>
      <label>
        To sequence
        <input value={toSequence} onChange={(e) => setToSequence(e.target.value)} />
      </label>
      <button type="submit">Apply filters</button>
    </form>
  );
}
