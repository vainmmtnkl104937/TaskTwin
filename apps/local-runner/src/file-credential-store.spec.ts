import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CredentialStoreError } from './credential-store.js';
import { FileCredentialStore } from './file-credential-store.js';

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = join(tmpdir(), `tasktwin-runner-test-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  roots.push(root);
  return root;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('FileCredentialStore', () => {
  it('persists a validated credential across store instances', async () => {
    const root = await temporaryRoot();
    const store = new FileCredentialStore(root);
    const credential = {
      schemaVersion: 1 as const,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: '753ff8fc-4267-4d99-b741-41485f5bab45',
      workspaceId: 'ad8ca9d9-648e-47c5-8443-408a1308315d',
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: 'A'.repeat(43),
      savedAt: '2026-07-30T12:00:00.000Z',
    };
    await store.save(credential);
    await expect(new FileCredentialStore(root).load()).resolves.toEqual(
      credential,
    );
    expect(
      await readFile(join(root, '.tasktwin', 'runner-credential.json'), 'utf8'),
    ).not.toContain('.tmp');
    if (process.platform !== 'win32') {
      const { stat } = await import('node:fs/promises');
      expect(
        (await stat(join(root, '.tasktwin', 'runner-credential.json'))).mode &
          0o777,
      ).toBe(0o600);
    }
  });

  it('rejects corrupted files without returning their contents', async () => {
    const root = await temporaryRoot();
    const directory = join(root, '.tasktwin');
    await mkdir(directory, { recursive: true });
    const file = join(directory, 'runner-credential.json');
    await writeFile(file, '{"credential":"raw-secret"}', 'utf8');
    await chmod(file, 0o600);
    await expect(new FileCredentialStore(root).load()).rejects.toEqual(
      new CredentialStoreError(),
    );
  });

  it('clears the local credential idempotently', async () => {
    const root = await temporaryRoot();
    const store = new FileCredentialStore(root);
    await store.clear();
    await expect(store.load()).resolves.toBeNull();
  });
});
