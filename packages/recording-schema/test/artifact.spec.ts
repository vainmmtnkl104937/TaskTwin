import { describe, expect, it } from 'vitest';

import {
  createRecordingPrivacySummary,
  RecordingArtifactSchema,
  RecordingPrivacySummarySchema,
} from '../src/index.js';
import { loadValidRecordingArtifact } from './fixture.js';

describe('RecordingArtifactSchema', () => {
  it('accepts the reusable valid artifact and remains JSON-serializable', () => {
    const artifact = loadValidRecordingArtifact();
    const serialized = JSON.stringify(artifact);

    expect(RecordingArtifactSchema.parse(JSON.parse(serialized))).toEqual(
      artifact,
    );
  });

  it('allows an empty artifact with zero counts', () => {
    const artifact = loadValidRecordingArtifact();
    artifact.events = [];
    artifact.eventCount = 0;
    artifact.lastSequence = 0;
    artifact.privacySummary = createRecordingPrivacySummary([]);

    expect(RecordingArtifactSchema.safeParse(artifact).success).toBe(true);
  });

  it('rejects a mismatched event count', () => {
    const artifact = loadValidRecordingArtifact();
    artifact.eventCount = 2;

    expect(RecordingArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects duplicate sequence numbers', () => {
    const artifact = loadValidRecordingArtifact();
    const second = artifact.events[1];
    expect(second).toBeDefined();
    if (second === undefined) return;
    second.sequence = 1;

    expect(RecordingArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects a sequence gap', () => {
    const artifact = loadValidRecordingArtifact();
    const second = artifact.events[1];
    expect(second).toBeDefined();
    if (second === undefined) return;
    second.sequence = 3;

    expect(RecordingArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects duplicate event IDs', () => {
    const artifact = loadValidRecordingArtifact();
    const first = artifact.events[0];
    const second = artifact.events[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    second.eventId = first.eventId;

    expect(RecordingArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects a mismatched event session', () => {
    const artifact = loadValidRecordingArtifact();
    const second = artifact.events[1];
    expect(second).toBeDefined();
    if (second === undefined) return;
    second.sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    expect(RecordingArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects a mismatched event origin', () => {
    const artifact = loadValidRecordingArtifact();
    const second = artifact.events[1];
    expect(second).toBeDefined();
    if (second === undefined) return;
    second.origin = 'https://other.example.test';

    expect(RecordingArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects a complete URL as target origin', () => {
    const artifact = loadValidRecordingArtifact();
    artifact.targetOrigin = 'https://example.test/account';

    expect(RecordingArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects an origin longer than the persistence boundary', () => {
    const artifact = loadValidRecordingArtifact();
    artifact.targetOrigin = `https://${'a'.repeat(510)}.test`;

    expect(RecordingArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects a mismatched privacy summary', () => {
    const artifact = loadValidRecordingArtifact();
    artifact.privacySummary.policyCounts.allow = 2;
    artifact.privacySummary.policyCounts.mask = 0;

    expect(RecordingArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects a stop time before the start time', () => {
    const artifact = loadValidRecordingArtifact();
    artifact.stoppedAt = '2026-07-29T09:59:59.000Z';

    expect(RecordingArtifactSchema.safeParse(artifact).success).toBe(false);
  });
});

describe('recording privacy summary', () => {
  it('deterministically summarizes policy and sensitivity counts', () => {
    const artifact = loadValidRecordingArtifact();

    expect(createRecordingPrivacySummary(artifact.events)).toEqual(
      artifact.privacySummary,
    );
  });

  it('rejects count totals that disagree', () => {
    const summary = structuredClone(
      loadValidRecordingArtifact().privacySummary,
    );
    summary.totalEvents = 2;

    expect(RecordingPrivacySummarySchema.safeParse(summary).success).toBe(
      false,
    );
  });
});
