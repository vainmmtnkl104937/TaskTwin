import { RunStateMachine } from '@tasktwin/workflow-engine';
import {
  DEFAULT_WORKSPACE_EXECUTION_POLICY,
  WorkspaceExecutionPolicyDefinitionSchema,
} from '@tasktwin/workflow-policy';
import type { RunnerStartupStatus } from '@tasktwin/runner-update';

import type { BrowserSessionFactory } from '../execution/browser-session.js';

export interface RunnerStartupHealthProbeInput {
  readonly identityMatches: boolean;
  readonly instanceLockHeld: boolean;
  readonly localSecretStoreHealthy: boolean;
  readonly nativeSecretAutoUnlockRequired: boolean;
  readonly nativeSecretAutoUnlockVerified: boolean;
  readonly signal: AbortSignal;
}

export interface RunnerStartupHealthProbe {
  run(
    input: RunnerStartupHealthProbeInput,
  ): Promise<RunnerStartupStatus['checks']>;
}

export class LocalRunnerStartupHealthProbe implements RunnerStartupHealthProbe {
  constructor(private readonly browserSessions?: BrowserSessionFactory) {}

  async run(
    input: RunnerStartupHealthProbeInput,
  ): Promise<RunnerStartupStatus['checks']> {
    const workflowEngine = this.probeWorkflowEngine();
    const policyRuntime = this.probePolicyRuntime();
    const chromium = await this.probeChromium(input.signal);
    return {
      identity: input.identityMatches ? 'passed' : 'failed',
      instanceLock: input.instanceLockHeld ? 'passed' : 'failed',
      workflowEngine: workflowEngine ? 'passed' : 'failed',
      policyRuntime: policyRuntime ? 'passed' : 'failed',
      chromium,
      localSecretStore: input.localSecretStoreHealthy ? 'passed' : 'failed',
      nativeSecretAutoUnlock: input.nativeSecretAutoUnlockRequired
        ? input.nativeSecretAutoUnlockVerified
          ? 'passed'
          : 'failed'
        : 'not_required',
    };
  }

  private probeWorkflowEngine(): boolean {
    try {
      return new RunStateMachine().state === 'pending';
    } catch {
      return false;
    }
  }

  private probePolicyRuntime(): boolean {
    return WorkspaceExecutionPolicyDefinitionSchema.safeParse(
      DEFAULT_WORKSPACE_EXECUTION_POLICY,
    ).success;
  }

  private async probeChromium(
    signal: AbortSignal,
  ): Promise<'passed' | 'failed'> {
    if (signal.aborted || this.browserSessions === undefined) return 'failed';
    try {
      const session = await this.browserSessions.create({
        headless: true,
        actionTimeoutMs: 10_000,
        navigationTimeoutMs: 30_000,
      });
      if (signal.aborted) {
        await session.close().catch(() => undefined);
        return 'failed';
      }
      return (await session.close()) === null ? 'passed' : 'failed';
    } catch {
      return 'failed';
    }
  }
}
