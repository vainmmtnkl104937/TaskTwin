import { homedir } from 'node:os';
import { parseArgs } from 'node:util';

import {
  evaluateUpgradePreflight,
  summarizeRelease,
  summarizeUpgradePreflight,
  type RunnerBuildIdentity,
  type TrustedReleaseKey,
} from '@tasktwin/runner-release';

import { inspectInstalledRunnerState } from './local-state-inspector.js';
import { verifyReleaseFiles } from './release-file-verifier.js';

export async function runReleaseCli(input: {
  argv: string[];
  buildIdentity: RunnerBuildIdentity;
  output: { write(message: string): void };
  trustedKeys?: readonly TrustedReleaseKey[] | undefined;
}): Promise<number> {
  if (input.argv[0] === 'release' && input.argv[1] === 'verify') {
    if (input.argv.length !== 5) {
      throw new Error(
        'Usage: runner release verify <manifest> <signature> <artifact>',
      );
    }
    const verified = await verifyReleaseFiles({
      manifestPath: input.argv[2] ?? '',
      signaturePath: input.argv[3] ?? '',
      artifactPath: input.argv[4] ?? '',
      trustedKeys: input.trustedKeys,
    });
    input.output.write(
      JSON.stringify({
        verified: true,
        release: summarizeRelease(verified.manifest),
      }),
    );
    return 0;
  }
  if (input.argv[0] === 'upgrade' && input.argv[1] === 'preflight') {
    const parsed = parseArgs({
      args: input.argv.slice(2),
      options: { 'data-root': { type: 'string' } },
      allowPositionals: true,
      strict: true,
    });
    if (parsed.positionals.length !== 3) {
      throw new Error(
        'Usage: runner upgrade preflight <manifest> <signature> <artifact>',
      );
    }
    const [manifestPath, signaturePath, artifactPath] = parsed.positionals;
    const verified = await verifyReleaseFiles({
      manifestPath: manifestPath ?? '',
      signaturePath: signaturePath ?? '',
      artifactPath: artifactPath ?? '',
      trustedKeys: input.trustedKeys,
    });
    const state = await inspectInstalledRunnerState(
      parsed.values['data-root'] ?? homedir(),
    );
    const result = evaluateUpgradePreflight({
      currentVersion: input.buildIdentity.version,
      targetRelease: verified.manifest,
      ...state,
      platform: input.buildIdentity.platform,
      architecture: input.buildIdentity.architecture,
    });
    input.output.write(JSON.stringify(summarizeUpgradePreflight(result)));
    return result.decision === 'compatible' ? 0 : 2;
  }
  throw new Error('Unknown Runner release command.');
}
