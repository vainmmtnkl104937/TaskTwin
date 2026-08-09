import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deriveRunnerReleaseId,
  type RunnerUpdateId,
} from '@tasktwin/runner-update';
import { afterEach, describe, expect, it } from 'vitest';

import {
  FileActiveReleaseStore,
  FileRunnerUpdateJournalStore,
} from './update-record-stores.js';

const temporaryDirectories: string[] = [];
const NOW = '2026-08-09T00:00:00.000Z';
const UPDATE_ID = `ru1_${'a'.repeat(64)}` as RunnerUpdateId;
const SOURCE_ID = deriveRunnerReleaseId('b'.repeat(64));
const TARGET_ID = deriveRunnerReleaseId('c'.repeat(64));

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('Runner update atomic records', () => {
  it('persists strict transitions and exposes only safe maintenance state', async () => {
    const directory = await temporaryDirectory();
    const store = new FileRunnerUpdateJournalStore(
      join(directory, 'update-journal.v1.json'),
    );
    await store.begin(beginInput());
    await expect(store.current()).resolves.toEqual({ state: 'inactive' });
    await store.transition({
      updateId: UPDATE_ID,
      state: 'draining',
      timestamp: NOW,
    });
    await expect(store.current()).resolves.toEqual({
      state: 'draining',
      updateId: UPDATE_ID,
    });
    await expect(
      store.transition({
        updateId: UPDATE_ID,
        state: 'succeeded',
        timestamp: NOW,
      }),
    ).rejects.toMatchObject({ code: 'update_state_transition_invalid' });
    const serialized = await readFile(store.path, 'utf8');
    expect(serialized).not.toContain('UPDATE_SECRET_LEAK_32');
    expect(serialized).not.toContain('UPDATE_CREDENTIAL_LEAK_32');
    expect(serialized).not.toContain('UPDATE_PROTECTED_KEY_LEAK_32');
  });

  it('rejects corrupted journals instead of repairing them', async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, 'update-journal.v1.json');
    const store = new FileRunnerUpdateJournalStore(path);
    await writeFile(path, '{"schemaVersion":1,"credential":"leak"}');
    await expect(store.read()).rejects.toMatchObject({
      code: 'update_journal_invalid',
    });
  });

  it('atomically changes the active release once and retains the prior ID', async () => {
    const directory = await temporaryDirectory();
    const store = new FileActiveReleaseStore(
      join(directory, 'active-release.v1.json'),
    );
    await store.initialize({
      releaseId: SOURCE_ID,
      activationId: 'activation_source',
      timestamp: NOW,
    });
    const switched = await store.switch({
      expectedCurrentReleaseId: SOURCE_ID,
      targetReleaseId: TARGET_ID,
      activationId: 'activation_target',
      timestamp: NOW,
    });
    expect(switched).toMatchObject({
      currentReleaseId: TARGET_ID,
      previousReleaseId: SOURCE_ID,
      generation: 2,
    });
    await expect(
      store.switch({
        expectedCurrentReleaseId: SOURCE_ID,
        targetReleaseId: TARGET_ID,
        activationId: 'activation_target',
        timestamp: NOW,
      }),
    ).rejects.toMatchObject({ code: 'update_service_switch_failed' });
  });
});

function beginInput() {
  return {
    operation: 'apply' as const,
    updateId: UPDATE_ID,
    sourceReleaseId: SOURCE_ID,
    targetReleaseId: TARGET_ID,
    fromVersion: '1.0.0',
    targetVersion: '1.1.0',
    sourceManifestSha256: 'b'.repeat(64),
    targetManifestSha256: 'c'.repeat(64),
    sourceArtifactSha256: 'd'.repeat(64),
    targetArtifactSha256: 'e'.repeat(64),
    timestamp: NOW,
  };
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'tasktwin-update-record-'));
  temporaryDirectories.push(path);
  return path;
}
