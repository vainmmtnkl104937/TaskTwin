import { serializeCanonicalJson } from '@tasktwin/audit-trail';

import { ReleaseManifestSchema, type ReleaseManifest } from './contracts.js';

export function parseReleaseManifest(input: unknown): ReleaseManifest {
  return ReleaseManifestSchema.parse(input);
}

export function canonicalizeReleaseManifest(input: unknown): string {
  return serializeCanonicalJson(parseReleaseManifest(input));
}
