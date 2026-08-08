import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryCredentialStore } from '../credential-store.js';
import type { RunnerControlPlaneTransport } from '../control-plane-client.js';
import { FileLocalSecretVaultStore } from './local-secret-vault-store.js';
import { LocalSecretVaultService } from './local-secret-vault-service.js';
import { NodeScryptMasterKeyProtector } from './node-secret-crypto.js';
import type { NoEchoPrompt } from './no-echo-prompt.js';
import { runSecretsCli } from './secrets-cli.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('runner secrets CLI', () => {
  it('supports init/set/list/remove with prompt-only values and no reveal command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tasktwin-secrets-cli-'));
    roots.push(root);
    const credentials = new InMemoryCredentialStore();
    const workspaceId = randomUUID();
    const runnerDeviceId = randomUUID();
    await credentials.save({
      schemaVersion: 1,
      controlPlaneOrigin: 'https://control.tasktwin.test',
      workspaceId,
      runnerDeviceId,
      installationId: randomUUID(),
      credential: 'A'.repeat(43),
      savedAt: new Date().toISOString(),
    });
    const values = [
      'test-passphrase', 'test-passphrase',
      'test-passphrase', 'CLI_RECOGNIZABLE_SECRET_29', 'CLI_RECOGNIZABLE_SECRET_29',
      'test-passphrase',
      'test-passphrase', 'CLI_REPLACEMENT_SECRET_29', 'CLI_REPLACEMENT_SECRET_29',
      'test-passphrase', 'REMOVE',
    ];
    const prompt: NoEchoPrompt = {
      isAvailable: () => true,
      read: vi.fn(async () => values.shift() ?? ''),
    };
    const transport = {
      synchronizeSecretInventory: vi.fn(async (_credential, request) => {
        if (request.storeStatus !== 'ready') throw new Error('unexpected status');
        return {
          schemaVersion: 1 as const,
          idempotent: false,
          vaultId: request.vaultId,
          vaultRevision: request.vaultRevision,
          inventoryDigest: request.inventoryDigest,
          storeStatus: 'ready' as const,
          synchronizedAt: new Date().toISOString(),
        };
      }),
    } as unknown as RunnerControlPlaneTransport;
    const output: string[] = [];
    const vault = new LocalSecretVaultService(
      new FileLocalSecretVaultStore(root),
      new NodeScryptMasterKeyProtector(),
    );
    const invoke = (args: string[]) => runSecretsCli({ args, credentials, vault,
      prompt, transport, output: { write: (message) => output.push(message) } });

    await expect(invoke(['init'])).resolves.toBe(0);
    await expect(invoke(['protector', 'status'])).resolves.toBe(0);
    expect(output).toContain(
      'Local Secret Store protector: passphrase; automatic unlock unavailable.',
    );
    await expect(invoke(['set', 'LOGIN_PASSWORD'])).resolves.toBe(0);
    await expect(invoke(['list'])).resolves.toBe(0);
    expect(output.join('\n')).toContain('LOGIN_PASSWORD');
    expect(output.join('\n')).not.toContain('CLI_RECOGNIZABLE_SECRET_29');
    const firstVersionId = (await vault.inventory()).entries[0]!.secretVersionId;
    await expect(invoke(['set', 'LOGIN_PASSWORD'])).resolves.toBe(0);
    const replacementVersionId = (await vault.inventory()).entries[0]!.secretVersionId;
    expect(replacementVersionId).not.toBe(firstVersionId);
    expect(output.join('\n')).not.toContain('CLI_REPLACEMENT_SECRET_29');
    await expect(invoke(['set', 'LOGIN_PASSWORD', 'argv-secret'])).rejects.toThrow(
      'requires exactly one alias',
    );
    await expect(invoke(['init', 'argv-passphrase'])).rejects.toThrow(
      'accepts no arguments',
    );
    await expect(
      invoke([
        'protector',
        'migrate',
        '--to',
        'os-native',
        'argv-passphrase',
      ]),
    ).rejects.toThrow('Only status and migrate --to os-native are supported');
    await expect(invoke(['remove', 'LOGIN_PASSWORD'])).resolves.toBe(0);
    expect((await vault.inventory()).entries).toEqual([]);
    await expect(invoke(['reveal', 'LOGIN_PASSWORD'])).rejects.toThrow(
      'Reveal and export are not supported',
    );
    expect(transport.synchronizeSecretInventory).toHaveBeenCalledTimes(4);
  }, 15_000);
});
