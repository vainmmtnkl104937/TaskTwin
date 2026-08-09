import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);

async function workflow(name: string): Promise<string> {
  return (
    await readFile(
    resolve(repositoryRoot, '.github', 'workflows', name),
    'utf8',
    )
  ).replaceAll('\r\n', '\n');
}

describe('Runner release workflow trust boundaries', () => {
  it('publishes only from a version-tag candidate that passed every gate', async () => {
    const source = await workflow('release-runner.yml');
    expect(source).toContain("tags:\n      - 'runner-v*'");
    expect(source).not.toContain('pull_request:');
    expect(source).toContain('needs: build_candidate');
    expect(source).toContain('environment: runner-production-release');
    expect(source).toContain('pnpm install --frozen-lockfile');
    expect(source).toContain('pnpm lint');
    expect(source).toContain('pnpm typecheck');
    expect(source).toContain('pnpm test');
    expect(source).toContain('pnpm build');
    expect(source).not.toContain('continue-on-error');
    expect(source).not.toContain('--clobber');
    expect(source.match(/ref: \$\{\{ github\.sha \}\}/g)).toHaveLength(2);
    expect(source).toContain('Reverify trusted tag commit before signing');

    const signIndex = source.indexOf('- name: Sign canonical manifest');
    const verifyIndex = source.indexOf(
      '- name: Self-verify signed manifest and artifact',
    );
    const publishIndex = source.indexOf(
      '- name: Publish immutable GitHub Release',
    );
    expect(signIndex).toBeGreaterThan(0);
    expect(verifyIndex).toBeGreaterThan(signIndex);
    expect(publishIndex).toBeGreaterThan(verifyIndex);
  });

  it('exposes the production credential to exactly the signing step', async () => {
    const source = await workflow('release-runner.yml');
    expect(
      source.match(/secrets\.RUNNER_RELEASE_SIGNING_KEY_PKCS8_BASE64/g),
    ).toHaveLength(1);
    const secretIndex = source.indexOf(
      'secrets.RUNNER_RELEASE_SIGNING_KEY_PKCS8_BASE64',
    );
    const signingStepIndex = source.indexOf('- name: Sign canonical manifest');
    const nextStepIndex = source.indexOf(
      '- name: Self-verify signed manifest and artifact',
    );
    expect(secretIndex).toBeGreaterThan(signingStepIndex);
    expect(secretIndex).toBeLessThan(nextStepIndex);
    const signingScript = await readFile(
      resolve(
        repositoryRoot,
        'apps',
        'local-runner',
        'scripts',
        'release',
        'sign-release-manifest.mjs',
      ),
      'utf8',
    );
    expect(signingScript).toContain('privateKeyBytes.fill(0)');
    expect(signingScript).toContain(
      "delete process.env['TASKTWIN_RUNNER_RELEASE_SIGNING_KEY_PKCS8_BASE64']",
    );
  });

  it('would publish exactly artifact, manifest, and detached signature', async () => {
    const source = await workflow('release-runner.yml');
    expect(source).toContain(
      'release upload $tag $artifact $manifest $signature',
    );
    expect(source).toContain('The final release file set is invalid.');
    expect(source).toContain('The draft release asset set is invalid.');
    expect(source).toContain(
      'tasktwin-runner-$($env:VERSION)-release-signature.json',
    );
  });

  it('passes ref and configured key values through environment variables', async () => {
    const source = await workflow('release-runner.yml');
    expect(source).not.toContain("'${{ github.ref_name }}'");
    expect(source).not.toContain("'${{ vars.RUNNER_RELEASE_SIGNING_KEY_ID }}'");
    expect(source).toContain('$tag = $env:TRIGGER_TAG');
    expect(source).toContain('--key-id $env:RUNNER_RELEASE_SIGNING_KEY_ID');
  });

  it('keeps the dry run secret-free and non-publishing', async () => {
    const source = await workflow('runner-release-dry-run.yml');
    expect(source).toContain('pull_request:');
    expect(source).toContain('workflow_dispatch:');
    expect(source).toContain('release:dry-run');
    expect(source).not.toContain('secrets.');
    expect(source).not.toContain('runner-production-release');
    expect(source).not.toContain('gh release');
    expect(source).not.toContain('contents: write');
  });

  it('pins every third-party action to a full commit', async () => {
    for (const name of ['release-runner.yml', 'runner-release-dry-run.yml']) {
      const source = await workflow(name);
      const actionReferences = [...source.matchAll(/uses: [^@\s]+@([^\s]+)/g)];
      expect(actionReferences.length).toBeGreaterThan(0);
      for (const reference of actionReferences) {
        expect(reference[1]).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });
});
