import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StoredRunnerCredential } from '@tasktwin/runner-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RunnerControlPlaneTransport } from '../control-plane-client.js';
import {
  FileRunnerEncryptionKeyStore,
  InMemoryRunnerEncryptionKeyStore,
  RunnerEncryptionKeyStoreError,
} from './runner-encryption-key-store.js';
import { RunnerKeyManager } from './runner-key-manager.js';

const roots: string[] = [];
const credential: StoredRunnerCredential = {
  schemaVersion: 1,
  controlPlaneOrigin: 'http://127.0.0.1:3001',
  runnerDeviceId: '15448cc6-d20d-4b89-961e-f090f29baa10',
  workspaceId: '85ea1dc3-0ab5-4407-b54a-f98015c99729',
  installationId: '41d7b5b6-352d-4268-8e89-0b1483ca111d',
  credential: 'A'.repeat(43),
  savedAt: '2029-01-01T00:00:00.000Z',
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

function transport() {
  return {
    registerEncryptionKey: vi.fn(async (_credential, request) => ({
      schemaVersion: 1 as const,
      idempotent: false,
      key: request.key,
    })),
  } as unknown as RunnerControlPlaneTransport;
}

describe('Runner key management', () => {
  it('generates once, registers only public metadata, and survives manager restart', async () => {
    const store = new InMemoryRunnerEncryptionKeyStore();
    const remote = transport();
    const first = await new RunnerKeyManager(store, remote).ensureRegistered(
      credential,
    );
    const second = await new RunnerKeyManager(store, remote).ensureRegistered(
      credential,
    );
    expect(second).toEqual(first);
    expect(first.metadata.keyId).toMatch(/^rk1_/u);
    expect(first.privateKeyPkcs8.length).toBeGreaterThan(1_000);
    const sent = vi.mocked(remote.registerEncryptionKey).mock.calls[0]?.[1];
    expect(sent).toEqual({ schemaVersion: 1, key: first.metadata });
    expect(JSON.stringify(sent)).not.toContain(first.privateKeyPkcs8);
  });

  it('persists atomically and rejects a corrupted file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tasktwin-key-'));
    roots.push(root);
    const remote = transport();
    const store = new FileRunnerEncryptionKeyStore(root);
    const created = await new RunnerKeyManager(store, remote).ensureRegistered(
      credential,
    );
    expect(await new FileRunnerEncryptionKeyStore(root).load()).toEqual(
      created,
    );
    const filePath = join(root, '.tasktwin', 'runner-encryption-key.json');
    expect((await readFile(filePath, 'utf8')).trim()).not.toBe('');
    await mkdir(join(root, '.tasktwin'), { recursive: true });
    await writeFile(filePath, '{"privateKeyPkcs8":"exposed"}', 'utf8');
    await expect(store.load()).rejects.toBeInstanceOf(
      RunnerEncryptionKeyStoreError,
    );
  });
});
