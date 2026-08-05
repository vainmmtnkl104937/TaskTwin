import { randomUUID } from 'node:crypto';

import {
  SafeExecutionException,
  WorkflowEngine,
  type WorkflowExecutionResult,
  type WorkflowProgressSink,
  type WorkflowRuntimeValueResolver,
  type WorkflowApprovalCoordinator,
  type WorkflowRecoveryCoordinator,
} from '@tasktwin/workflow-engine';

import type { BrowserSessionFactory } from './browser-session.js';
import { LocalExecutionRequestSchema } from './contracts.js';
import { PlaywrightWorkflowExecutionAdapter } from './playwright-workflow-execution-adapter.js';
import type { LocatorRepairBrowserBridge } from '../locator-repair/browser-bridge.js';
import type {
  WorkflowPolicyEvaluation,
  WorkspaceExecutionPolicyDefinition,
} from '@tasktwin/workflow-policy';
import type { WorkflowDefinition } from '@tasktwin/workflow-schema';

export interface LocalRuntimePolicyContext {
  definition: WorkspaceExecutionPolicyDefinition;
  evaluation: WorkflowPolicyEvaluation;
  workflow: WorkflowDefinition;
}

export class LocalWorkflowExecutor {
  constructor(
    private readonly sessions: BrowserSessionFactory,
    private readonly progressSink?: WorkflowProgressSink,
    private readonly approvalCoordinator?: WorkflowApprovalCoordinator,
    private readonly recoveryCoordinator?: WorkflowRecoveryCoordinator,
    private readonly locatorRepairBridge?: LocatorRepairBrowserBridge,
    private readonly runtimePolicy?: LocalRuntimePolicyContext,
  ) {}

  execute(
    input: unknown,
    signal?: AbortSignal,
    executionId?: string,
    valueResolver?: WorkflowRuntimeValueResolver,
  ): Promise<WorkflowExecutionResult> {
    const request = LocalExecutionRequestSchema.safeParse(input);
    if (!request.success) {
      throw new SafeExecutionException('INVALID_EXECUTION_REQUEST');
    }
    const adapter = new PlaywrightWorkflowExecutionAdapter(
      this.sessions,
      {
        headless: request.data.options.headless,
        actionTimeoutMs: request.data.options.actionTimeoutMs,
        navigationTimeoutMs: request.data.options.navigationTimeoutMs,
      },
      this.locatorRepairBridge,
      this.runtimePolicy,
    );
    const engine = new WorkflowEngine(adapter, {
      createExecutionId:
        executionId === undefined ? randomUUID : () => executionId,
      ...(this.progressSink === undefined
        ? {}
        : { progressSink: this.progressSink }),
      ...(valueResolver === undefined ? {} : { valueResolver }),
      ...(this.approvalCoordinator === undefined
        ? {}
        : { approvalCoordinator: this.approvalCoordinator }),
      ...(this.recoveryCoordinator === undefined
        ? {}
        : { recoveryCoordinator: this.recoveryCoordinator }),
    });
    return engine.execute(
      {
        schemaVersion: request.data.schemaVersion,
        workflow: request.data.workflow,
        inputs: request.data.inputs,
        allowedOrigins: request.data.allowedOrigins,
        options: {
          totalTimeoutMs: request.data.options.totalTimeoutMs,
          stepTimeoutMs: request.data.options.stepTimeoutMs,
          recoveryMode: request.data.options.recoveryMode,
        },
      },
      signal,
    );
  }
}
