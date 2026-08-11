import type { TrustedReleaseSource } from '@tasktwin/runner-acquisition';

// Production sources are reviewed deployment trust roots. The CLI has no flag
// that can add an origin. An empty registry deliberately fails closed.
export const TRUSTED_RUNNER_RELEASE_SOURCES: readonly TrustedReleaseSource[] =
  [];
