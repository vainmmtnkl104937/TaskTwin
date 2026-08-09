import {
  ActiveReleaseRecordSchema,
  RunnerUpdateError,
  RunnerUpdateJournalSchema,
  assertRunnerUpdateStateTransition,
  type ActiveReleaseRecord,
  type RunnerActivationId,
  type RunnerReleaseId,
  type RunnerUpdateErrorCode,
  type RunnerUpdateId,
  type RunnerUpdateJournal,
  type RunnerUpdateOperation,
  type RunnerUpdateState,
} from '@tasktwin/runner-update';

import { AtomicJsonStore } from './atomic-json-store.js';
import type { RunnerUpdateMaintenanceSnapshot } from '../service/update-maintenance.js';

export interface BeginRunnerUpdateInput {
  readonly operation: RunnerUpdateOperation;
  readonly updateId: RunnerUpdateId;
  readonly sourceReleaseId: RunnerReleaseId;
  readonly targetReleaseId: RunnerReleaseId;
  readonly fromVersion: string;
  readonly targetVersion: string;
  readonly sourceManifestSha256: string;
  readonly targetManifestSha256: string;
  readonly sourceArtifactSha256: string;
  readonly targetArtifactSha256: string;
  readonly timestamp: string;
}

const REUSABLE_TERMINAL_STATES = new Set<RunnerUpdateState>([
  'idle',
  'succeeded',
  'failed_before_switch',
  'rolled_back',
]);

export class FileRunnerUpdateJournalStore {
  private readonly record: AtomicJsonStore<RunnerUpdateJournal>;

  constructor(readonly path: string) {
    this.record = new AtomicJsonStore(path, RunnerUpdateJournalSchema);
  }

  async read(): Promise<RunnerUpdateJournal | null> {
    try {
      return await this.record.read();
    } catch {
      throw new RunnerUpdateError(
        'update_journal_invalid',
        'The local Runner update journal is invalid.',
      );
    }
  }

  async begin(input: BeginRunnerUpdateInput): Promise<RunnerUpdateJournal> {
    const current = await this.read();
    if (current !== null && !REUSABLE_TERMINAL_STATES.has(current.state)) {
      throw new RunnerUpdateError(
        current.state === 'manual_recovery_required'
          ? 'update_manual_recovery_required'
          : 'update_already_in_progress',
        'The previous Runner update is not in a reusable terminal state.',
      );
    }
    let revision = 1;
    if (current !== null) {
      revision = current.revision + 1;
      if (current.state !== 'idle') {
        assertRunnerUpdateStateTransition(current.state, 'idle');
        await this.write({
          ...current,
          revision,
          state: 'idle',
          updatedAt: input.timestamp,
          failureCode: undefined,
        });
        revision += 1;
      }
      assertRunnerUpdateStateTransition('idle', 'preparing');
    }
    const next = RunnerUpdateJournalSchema.parse({
      schemaVersion: 1,
      revision,
      operation: input.operation,
      updateId: input.updateId,
      state: 'preparing',
      sourceReleaseId: input.sourceReleaseId,
      targetReleaseId: input.targetReleaseId,
      fromVersion: input.fromVersion,
      targetVersion: input.targetVersion,
      sourceManifestSha256: input.sourceManifestSha256,
      targetManifestSha256: input.targetManifestSha256,
      sourceArtifactSha256: input.sourceArtifactSha256,
      targetArtifactSha256: input.targetArtifactSha256,
      startedAt: input.timestamp,
      updatedAt: input.timestamp,
    });
    await this.write(next);
    return next;
  }

  async transition(input: {
    readonly updateId: RunnerUpdateId;
    readonly state: RunnerUpdateState;
    readonly timestamp: string;
    readonly failureCode?: RunnerUpdateErrorCode;
  }): Promise<RunnerUpdateJournal> {
    const current = await this.read();
    if (current === null || current.updateId !== input.updateId) {
      throw new RunnerUpdateError(
        'update_journal_invalid',
        'The Runner update journal identity does not match.',
      );
    }
    assertRunnerUpdateStateTransition(current.state, input.state);
    const next = RunnerUpdateJournalSchema.parse({
      ...current,
      revision: current.revision + 1,
      state: input.state,
      updatedAt: input.timestamp,
      failureCode: input.failureCode,
    });
    await this.write(next);
    return next;
  }

  async current(): Promise<RunnerUpdateMaintenanceSnapshot> {
    const journal = await this.read();
    if (journal === null) return { state: 'inactive' };
    switch (journal.state) {
      case 'draining':
      case 'staging':
      case 'ready_to_switch':
      case 'switching':
        return { state: 'draining', updateId: journal.updateId };
      case 'starting_target':
        return { state: 'starting_target', updateId: journal.updateId };
      case 'verifying_target':
        return { state: 'verifying_target', updateId: journal.updateId };
      case 'rolling_back':
        return { state: 'rolling_back', updateId: journal.updateId };
      case 'manual_recovery_required':
        return {
          state: 'manual_recovery_required',
          updateId: journal.updateId,
        };
      default:
        return { state: 'inactive' };
    }
  }

  async waitForChange(
    signal: AbortSignal,
    timeoutMilliseconds: number,
  ): Promise<void>;
  async waitForChange(input: {
    readonly afterRevision: number;
    readonly signal?: AbortSignal;
    readonly timeoutMilliseconds?: number;
  }): Promise<RunnerUpdateJournal | null>;
  async waitForChange(
    inputOrSignal:
      | AbortSignal
      | {
          readonly afterRevision: number;
          readonly signal?: AbortSignal;
          readonly timeoutMilliseconds?: number;
        },
    sourceTimeoutMilliseconds?: number,
  ): Promise<void | RunnerUpdateJournal | null> {
    if ('aborted' in inputOrSignal) {
      const before = await this.read();
      await this.waitUntilChanged({
        afterRevision: before?.revision ?? 0,
        signal: inputOrSignal,
        timeoutMilliseconds: sourceTimeoutMilliseconds ?? 1_000,
      });
      return;
    }
    return this.waitUntilChanged(inputOrSignal);
  }

  private async waitUntilChanged(input: {
    readonly afterRevision: number;
    readonly signal?: AbortSignal;
    readonly timeoutMilliseconds?: number;
  }): Promise<RunnerUpdateJournal | null> {
    const timeoutMilliseconds = input.timeoutMilliseconds ?? 1_000;
    const deadline = Date.now() + timeoutMilliseconds;
    do {
      if (input.signal?.aborted === true) return this.read();
      const journal = await this.read();
      if ((journal?.revision ?? 0) !== input.afterRevision) return journal;
      await delay(
        Math.min(100, Math.max(1, deadline - Date.now())),
        input.signal,
      );
    } while (Date.now() < deadline);
    return this.read();
  }

  private async write(journal: RunnerUpdateJournal): Promise<void> {
    try {
      await this.record.replace(RunnerUpdateJournalSchema.parse(journal));
    } catch (error: unknown) {
      if (error instanceof RunnerUpdateError) throw error;
      throw new RunnerUpdateError(
        'update_journal_write_failed',
        'The local Runner update journal could not be committed.',
      );
    }
  }
}

export class FileActiveReleaseStore {
  private readonly record: AtomicJsonStore<ActiveReleaseRecord>;

  constructor(readonly path: string) {
    this.record = new AtomicJsonStore(path, ActiveReleaseRecordSchema);
  }

  read(): Promise<ActiveReleaseRecord | null> {
    return this.record.read();
  }

  async initialize(input: {
    readonly releaseId: RunnerReleaseId;
    readonly activationId: RunnerActivationId;
    readonly timestamp: string;
  }): Promise<ActiveReleaseRecord> {
    const value = ActiveReleaseRecordSchema.parse({
      schemaVersion: 1,
      generation: 1,
      currentReleaseId: input.releaseId,
      previousReleaseId: null,
      currentActivationId: input.activationId,
      activatedAt: input.timestamp,
    });
    await this.record.create(value);
    return value;
  }

  async switch(input: {
    readonly expectedCurrentReleaseId: RunnerReleaseId;
    readonly targetReleaseId: RunnerReleaseId;
    readonly activationId: RunnerActivationId;
    readonly timestamp: string;
  }): Promise<ActiveReleaseRecord> {
    const current = await this.read();
    if (
      current === null ||
      current.currentReleaseId !== input.expectedCurrentReleaseId ||
      current.currentReleaseId === input.targetReleaseId
    ) {
      throw new RunnerUpdateError(
        'update_service_switch_failed',
        'The active Runner release changed unexpectedly.',
      );
    }
    const next = ActiveReleaseRecordSchema.parse({
      schemaVersion: 1,
      generation: current.generation + 1,
      currentReleaseId: input.targetReleaseId,
      previousReleaseId: current.currentReleaseId,
      currentActivationId: input.activationId,
      activatedAt: input.timestamp,
    });
    await this.record.replace(next);
    return next;
  }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.resolve();
  return new Promise((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolvePromise();
      },
      { once: true },
    );
  });
}
