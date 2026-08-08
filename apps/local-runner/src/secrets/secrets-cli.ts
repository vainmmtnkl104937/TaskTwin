import type { StoredRunnerCredential } from '@tasktwin/runner-protocol';
import { LocalSecretAliasSchema } from '@tasktwin/local-secret-store';

import type { RunnerControlPlaneTransport } from '../control-plane-client.js';
import type { RunnerCredentialStore } from '../credential-store.js';
import type { RunnerOutput } from '../runner-service.js';
import type { NoEchoPrompt } from './no-echo-prompt.js';
import { passphraseBytes } from './no-echo-prompt.js';
import type { LocalSecretVaultService } from './local-secret-vault-service.js';

export async function runSecretsCli(input: {
  args: string[];
  credentials: RunnerCredentialStore;
  vault: LocalSecretVaultService;
  prompt: NoEchoPrompt;
  transport: RunnerControlPlaneTransport;
  output: RunnerOutput;
  signal?: AbortSignal;
}): Promise<number> {
  const command = input.args[0] ?? 'status';
  const trailing = input.args.slice(1);
  const signal = input.signal ?? new AbortController().signal;
  const credential = await requireCredential(input.credentials);

  if (command === 'status') {
    if (trailing.length !== 0) throw new Error('Unexpected secrets status argument.');
    const status = await input.vault.status();
    input.output.write(
      `Local Secret Store: ${status.status}; revision: ${status.vaultRevision ?? 'none'}; configured aliases: ${status.configuredSecretCount}.`,
    );
    return 0;
  }

  if (command === 'protector') {
    const subcommand = trailing[0] ?? 'status';
    const protectorArgs = trailing.slice(1);
    if (subcommand === 'status') {
      assertNoArgs(protectorArgs, 'protector status');
      const profile = await input.vault.protectorProfile();
      input.output.write(
        profile === 'windows_dpapi_ng_machine_v1'
          ? 'Local Secret Store protector: Windows native; automatic unlock available.'
          : profile === 'local_secret_master_key_wrap_v1'
            ? 'Local Secret Store protector: passphrase; automatic unlock unavailable.'
            : 'Local Secret Store protector: unavailable.',
      );
      return 0;
    }
    if (
      subcommand === 'migrate' &&
      protectorArgs.length === 2 &&
      protectorArgs[0] === '--to' &&
      protectorArgs[1] === 'os-native'
    ) {
      const passphrase = passphraseBytes(
        await input.prompt.read('Current vault passphrase: ', signal),
      );
      try {
        const vault = await input.vault.migrateProtectorToNative({
          workspaceId: credential.workspaceId,
          runnerDeviceId: credential.runnerDeviceId,
          passphrase,
        });
        await synchronize(input.transport, input.vault, credential);
        input.output.write(
          `Local Secret Store protector migrated to Windows native protection at revision ${vault.revision}.`,
        );
        return 0;
      } finally {
        passphrase.fill(0);
      }
    }
    throw new Error('Unknown protector command. Only status and migrate --to os-native are supported.');
  }

  if (command === 'init') {
    assertNoArgs(trailing, 'init');
    const passphrase = await confirmedSecret(input.prompt, signal, 'New vault passphrase: ', 'Confirm vault passphrase: ');
    try {
      const vault = await input.vault.initialize({
        workspaceId: credential.workspaceId,
        runnerDeviceId: credential.runnerDeviceId,
        passphrase,
      });
      await synchronize(input.transport, input.vault, credential);
      input.output.write(`Local Secret Store initialized at revision ${vault.revision}.`);
      return 0;
    } finally {
      passphrase.fill(0);
    }
  }

  if (command === 'set') {
    const alias = exactlyOneAlias(trailing, 'set');
    const passphrase = await unlockForLocalMutation(input, credential, signal);
    let secret = '';
    let confirmation = '';
    try {
      secret = await input.prompt.read(`Secret value for ${alias}: `, signal);
      confirmation = await input.prompt.read(`Confirm secret value for ${alias}: `, signal);
      if (secret !== confirmation) throw new Error('Secret confirmation did not match.');
      const vault = await input.vault.setSecret({
        alias,
        plaintext: secret,
        ...(passphrase === null ? {} : { passphrase }),
      });
      await synchronize(input.transport, input.vault, credential);
      input.output.write(`Secret alias ${alias} stored at revision ${vault.revision}.`);
      return 0;
    } finally {
      secret = '';
      confirmation = '';
      passphrase?.fill(0);
    }
  }

  if (command === 'remove') {
    const alias = exactlyOneAlias(trailing, 'remove');
    const passphrase = await unlockForLocalMutation(input, credential, signal);
    let confirmation = '';
    try {
      confirmation = await input.prompt.read(`Type REMOVE to remove ${alias}: `, signal, 16);
      if (confirmation !== 'REMOVE') throw new Error('Secret removal cancelled.');
      const vault = await input.vault.removeSecret({
        alias,
        ...(passphrase === null ? {} : { passphrase }),
      });
      await synchronize(input.transport, input.vault, credential);
      input.output.write(`Secret alias ${alias} removed at revision ${vault.revision}.`);
      return 0;
    } finally {
      confirmation = '';
      passphrase?.fill(0);
    }
  }

  if (command === 'list') {
    assertNoArgs(trailing, 'list');
    const passphrase = await unlockForLocalMutation(input, credential, signal);
    try {
      const inventory = await input.vault.inventory();
      if (inventory.entries.length === 0) input.output.write('No secret aliases configured.');
      for (const entry of inventory.entries) {
        input.output.write(`${entry.alias} ${entry.secretVersionId}`);
      }
      return 0;
    } finally {
      passphrase?.fill(0);
    }
  }

  throw new Error('Unknown secrets command. Reveal and export are not supported.');
}

async function unlockForLocalMutation(
  input: {
    vault: LocalSecretVaultService;
    prompt: NoEchoPrompt;
  },
  credential: StoredRunnerCredential,
  signal: AbortSignal,
): Promise<Buffer | null> {
  const profile = await input.vault.protectorProfile();
  if (profile === 'windows_dpapi_ng_machine_v1') {
    await input.vault.unlock({
      workspaceId: credential.workspaceId,
      runnerDeviceId: credential.runnerDeviceId,
    });
    return null;
  }
  const passphrase = passphraseBytes(
    await input.prompt.read('Vault passphrase: ', signal),
  );
  try {
    await input.vault.unlock({
      workspaceId: credential.workspaceId,
      runnerDeviceId: credential.runnerDeviceId,
      passphrase,
    });
    return passphrase;
  } catch (error: unknown) {
    passphrase.fill(0);
    throw error;
  }
}

async function synchronize(
  transport: RunnerControlPlaneTransport,
  vault: LocalSecretVaultService,
  credential: StoredRunnerCredential,
): Promise<void> {
  const inventory = await vault.inventory();
  const response = await transport.synchronizeSecretInventory(credential, inventory);
  vault.markSynchronized({ schemaVersion: 1, vaultId: response.vaultId,
    vaultRevision: response.vaultRevision, inventoryDigest: response.inventoryDigest });
}

async function confirmedSecret(
  prompt: NoEchoPrompt,
  signal: AbortSignal,
  firstLabel: string,
  confirmationLabel: string,
): Promise<Buffer> {
  let first = await prompt.read(firstLabel, signal);
  let second = await prompt.read(confirmationLabel, signal);
  try {
    if (first.length === 0 || first !== second) throw new Error('Passphrase confirmation did not match.');
    return passphraseBytes(first);
  } finally {
    first = '';
    second = '';
  }
}

function exactlyOneAlias(args: string[], command: string): string {
  if (args.length !== 1) throw new Error(`secrets ${command} requires exactly one alias.`);
  return LocalSecretAliasSchema.parse(args[0]);
}

function assertNoArgs(args: string[], command: string): void {
  if (args.length !== 0) throw new Error(`secrets ${command} accepts no arguments.`);
}

async function requireCredential(store: RunnerCredentialStore): Promise<StoredRunnerCredential> {
  const credential = await store.load();
  if (credential === null) throw new Error('The Local Runner must be paired first.');
  return credential;
}
