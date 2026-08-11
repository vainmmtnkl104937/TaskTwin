import type { TrustedReleaseKey } from './contracts.js';

// Production trust roots are public keys and must be added only through a
// reviewed deployment change. An empty registry deliberately fails closed.
export const TRUSTED_RUNNER_RELEASE_KEYS: readonly TrustedReleaseKey[] = [];
