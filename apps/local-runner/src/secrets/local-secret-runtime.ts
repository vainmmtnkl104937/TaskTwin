import type { StoredRunnerCredential } from '@tasktwin/runner-protocol';
import type {
  LocalSecretInventoryPin,
  LocalSecretInventorySyncRequest,
} from '@tasktwin/local-secret-store';
import type {
  RunnerRuntimeMode,
  RunnerSecretUnlockMode,
} from '@tasktwin/runner-service-runtime';

import type { RunnerControlPlaneTransport } from '../control-plane-client.js';
import type { RunnerOutput } from '../runner-service.js';
import type { NoEchoPrompt } from './no-echo-prompt.js';
import { passphraseBytes } from './no-echo-prompt.js';
import type { LocalSecretVaultService } from './local-secret-vault-service.js';

export interface LocalSecretRuntime {
  prepare(credential: StoredRunnerCredential, signal: AbortSignal): Promise<void>;
  refresh(credential: StoredRunnerCredential): Promise<void>;
  isReady(): boolean;
  currentPin(): LocalSecretInventoryPin | undefined;
  isNativeUnlockVerified?(): boolean;
  secretUnlockMode?(): RunnerSecretUnlockMode;
  startupHealth?(): 'ready' | 'locked' | 'unavailable' | 'corrupted';
  dispose(): Promise<void>;
}

export class RunnerLocalSecretRuntime implements LocalSecretRuntime {
  private ready = false;
  private pin: LocalSecretInventoryPin | undefined;
  private nativeUnlockVerified = false;
  private configuredUnlockMode: RunnerSecretUnlockMode = 'none';
  private startupHealthStatus:
    | 'ready'
    | 'locked'
    | 'unavailable'
    | 'corrupted' = 'unavailable';

  constructor(
    private readonly vault: LocalSecretVaultService,
    private readonly prompt: NoEchoPrompt,
    private readonly transport: RunnerControlPlaneTransport,
    private readonly output: RunnerOutput,
    private readonly runtimeMode: RunnerRuntimeMode = 'unattended_process',
  ) {}

  async prepare(
    credential: StoredRunnerCredential,
    signal: AbortSignal,
  ): Promise<void> {
    const status = await this.vault.status();
    this.startupHealthStatus = status.status;
    if (status.status === 'unavailable') {
      await this.reportStatus(credential, 'unavailable');
      return;
    }
    if (status.status === 'corrupted') {
      await this.reportStatus(credential, 'corrupted');
      this.output.write('Local Secret Store status: corrupted.');
      return;
    }
    const protectorProfile = await this.vault.protectorProfile();
    this.configuredUnlockMode = protectorProfile === 'windows_dpapi_ng_machine_v1'
      ? 'os_native'
      : protectorProfile === 'local_secret_master_key_wrap_v1'
        ? 'manual'
        : 'none';
    if (protectorProfile === 'windows_dpapi_ng_machine_v1') {
      try {
        await this.vault.unlock({
          workspaceId: credential.workspaceId,
          runnerDeviceId: credential.runnerDeviceId,
        });
        this.nativeUnlockVerified = true;
        this.startupHealthStatus = 'ready';
        try {
          await this.refresh(credential);
          this.output.write('Local Secret Store unlocked natively and synchronized.');
        } catch {
          this.output.write('Local Secret Store unlocked natively; inventory synchronization is pending.');
        }
      } catch {
        this.nativeUnlockVerified = false;
        this.startupHealthStatus = 'locked';
        await this.vault.dispose();
        await this.reportStatus(credential, 'locked');
        this.output.write('Local Secret Store native unlock failed safely.');
      }
      return;
    }
    if (this.runtimeMode === 'service' || !this.prompt.isAvailable()) {
      this.startupHealthStatus = 'locked';
      await this.reportStatus(credential, 'locked');
      this.output.write('Local Secret Store status: locked.');
      return;
    }
    let passphrase: Buffer | null = null;
    try {
      passphrase = passphraseBytes(
        await this.prompt.read('Unlock Local Secret Store passphrase: ', signal),
      );
      await this.vault.unlock({
        workspaceId: credential.workspaceId,
        runnerDeviceId: credential.runnerDeviceId,
        passphrase,
      });
      this.startupHealthStatus = 'ready';
      try {
        await this.refresh(credential);
        this.output.write('Local Secret Store unlocked and synchronized.');
      } catch {
        this.output.write('Local Secret Store unlocked; inventory synchronization is pending.');
      }
    } catch {
      this.startupHealthStatus = 'locked';
      await this.vault.dispose();
      await this.reportStatus(credential, 'locked');
      this.output.write('Local Secret Store unlock failed safely.');
    } finally {
      passphrase?.fill(0);
    }
  }

  async refresh(credential: StoredRunnerCredential): Promise<void> {
    this.ready = false;
    this.pin = undefined;
    const inventory = await this.vault.inventory();
    const response = await this.transport.synchronizeSecretInventory(
      credential,
      inventory,
    );
    const pin = {
      schemaVersion: 1 as const,
      vaultId: response.vaultId,
      vaultRevision: response.vaultRevision,
      inventoryDigest: response.inventoryDigest,
    };
    this.vault.markSynchronized(pin);
    this.pin = pin;
    this.ready = await this.vault.isReady();
  }

  isReady(): boolean {
    return this.ready;
  }

  isNativeUnlockVerified(): boolean {
    return this.nativeUnlockVerified;
  }

  secretUnlockMode(): RunnerSecretUnlockMode {
    return this.configuredUnlockMode;
  }

  startupHealth(): 'ready' | 'locked' | 'unavailable' | 'corrupted' {
    return this.startupHealthStatus;
  }

  currentPin(): LocalSecretInventoryPin | undefined {
    return this.pin;
  }

  async dispose(): Promise<void> {
    this.ready = false;
    this.pin = undefined;
    this.nativeUnlockVerified = false;
    this.configuredUnlockMode = 'none';
    this.startupHealthStatus = 'unavailable';
    await this.vault.dispose();
  }

  private async reportStatus(
    credential: StoredRunnerCredential,
    storeStatus: 'locked' | 'unavailable' | 'corrupted',
  ): Promise<void> {
    const request: LocalSecretInventorySyncRequest = {
      schemaVersion: 1,
      profile: 'local_secret_inventory_v1',
      storeStatus,
    };
    await this.transport
      .synchronizeSecretInventory(credential, request)
      .catch(() => undefined);
  }
}
