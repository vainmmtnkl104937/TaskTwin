import type { TrustedReleaseKey } from '@tasktwin/runner-release';

// Fail closed until an operator adds a reviewed production public key in a
// dedicated key-provisioning change. Test and dry-run keys are injected and
// never become trusted by production builds.
export const TRUSTED_RUNNER_RELEASE_KEYS: readonly TrustedReleaseKey[] = [];
