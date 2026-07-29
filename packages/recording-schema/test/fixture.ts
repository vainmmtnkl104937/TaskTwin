import { readFileSync } from 'node:fs';

import {
  RecordingArtifactSchema,
  type RecordingArtifact,
} from '../src/index.js';

const FIXTURE_URL = new URL(
  '../fixtures/valid-recording-artifact.v1.json',
  import.meta.url,
);

export function loadValidRecordingArtifact(): RecordingArtifact {
  const fixture: unknown = JSON.parse(readFileSync(FIXTURE_URL, 'utf8'));
  return RecordingArtifactSchema.parse(fixture);
}
