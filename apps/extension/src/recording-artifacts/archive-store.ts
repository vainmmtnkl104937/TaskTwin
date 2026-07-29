import {
  RecordingArtifactSchema,
  type RecordingArtifact,
} from '@tasktwin/recording-schema';

import {
  LOCAL_RECORDING_ARCHIVE_STORAGE_KEY,
  LOCAL_RECORDING_OUTBOX_STORAGE_KEY,
  MAX_PENDING_RECORDING_OUTBOX_ENTRIES,
  MAX_RETAINED_RECORDING_ARTIFACTS,
  MAX_SERIALIZED_LOCAL_RECORDING_ARCHIVE_BYTES,
  MAX_SERIALIZED_RECORDING_ARTIFACT_BYTES,
} from './constants.js';
import {
  LocalRecordingArchiveSchema,
  LocalRecordingOutboxSchema,
  RecordingOutboxEntrySchema,
  type LocalRecordingArchive,
  type LocalRecordingOutbox,
  type RecordingOutboxEntry,
  type RecordingSyncErrorCode,
} from './contracts.js';

export type LocalRecordingStorageErrorCode =
  | 'INVALID_LOCAL_RECORDING_STORAGE'
  | 'LOCAL_RECORDING_ARTIFACT_TOO_LARGE'
  | 'LOCAL_RECORDING_ARCHIVE_LIMIT_REACHED'
  | 'LOCAL_RECORDING_OUTBOX_LIMIT_REACHED'
  | 'LOCAL_RECORDING_ARCHIVE_TOO_LARGE'
  | 'LOCAL_RECORDING_ARTIFACT_CONFLICT'
  | 'LOCAL_RECORDING_STORAGE_FAILURE';

export class LocalRecordingStorageError extends Error {
  constructor(readonly code: LocalRecordingStorageErrorCode) {
    super(code);
    this.name = 'LocalRecordingStorageError';
  }
}

export interface LocalRecordingStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface LocalRecordingArchiveLimits {
  maxArtifacts: number;
  maxArtifactBytes: number;
  maxPendingOutboxEntries: number;
  maxArchiveBytes: number;
}

export const DEFAULT_LOCAL_RECORDING_ARCHIVE_LIMITS =
  Object.freeze<LocalRecordingArchiveLimits>({
    maxArtifacts: MAX_RETAINED_RECORDING_ARTIFACTS,
    maxArtifactBytes: MAX_SERIALIZED_RECORDING_ARTIFACT_BYTES,
    maxPendingOutboxEntries: MAX_PENDING_RECORDING_OUTBOX_ENTRIES,
    maxArchiveBytes: MAX_SERIALIZED_LOCAL_RECORDING_ARCHIVE_BYTES,
  });

export interface RecordingArtifactArchive {
  finalize(
    artifact: RecordingArtifact,
    now: string,
  ): Promise<RecordingOutboxEntry>;
  loadArtifact(clientSessionId: string): Promise<RecordingArtifact | null>;
  loadOutboxEntry(
    clientSessionId: string,
  ): Promise<RecordingOutboxEntry | null>;
  beginSync(
    clientSessionId: string,
    now: string,
  ): Promise<{
    artifact: RecordingArtifact;
    entry: RecordingOutboxEntry;
  }>;
  markSynced(
    clientSessionId: string,
    remoteSessionId: string,
    now: string,
  ): Promise<RecordingOutboxEntry>;
  markFailed(
    clientSessionId: string,
    errorCode: RecordingSyncErrorCode,
    now: string,
  ): Promise<RecordingOutboxEntry>;
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function exactArtifactMatch(
  left: RecordingArtifact,
  right: RecordingArtifact,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function initialArchive(): LocalRecordingArchive {
  return LocalRecordingArchiveSchema.parse({
    schemaVersion: 1,
    artifacts: [],
    updatedAt: new Date(0).toISOString(),
  });
}

function initialOutbox(): LocalRecordingOutbox {
  return LocalRecordingOutboxSchema.parse({
    schemaVersion: 1,
    entries: [],
    updatedAt: new Date(0).toISOString(),
  });
}

export class ChromeLocalRecordingArchive implements RecordingArtifactArchive {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: LocalRecordingStorageArea = chrome.storage.local,
    private readonly limits: LocalRecordingArchiveLimits = DEFAULT_LOCAL_RECORDING_ARCHIVE_LIMITS,
  ) {}

  finalize(
    input: RecordingArtifact,
    now: string,
  ): Promise<RecordingOutboxEntry> {
    return this.enqueueMutation(() => this.finalizeUnsafe(input, now));
  }

  async loadArtifact(
    clientSessionId: string,
  ): Promise<RecordingArtifact | null> {
    const archive = await this.loadArchive();
    return (
      archive.artifacts.find(
        (artifact) => artifact.clientSessionId === clientSessionId,
      ) ?? null
    );
  }

  async loadOutboxEntry(
    clientSessionId: string,
  ): Promise<RecordingOutboxEntry | null> {
    const outbox = await this.loadOutbox();
    return (
      outbox.entries.find(
        (entry) => entry.clientSessionId === clientSessionId,
      ) ?? null
    );
  }

  beginSync(
    clientSessionId: string,
    now: string,
  ): Promise<{
    artifact: RecordingArtifact;
    entry: RecordingOutboxEntry;
  }> {
    return this.enqueueMutation(async () => {
      const archive = await this.loadArchive();
      const outbox = await this.loadOutbox();
      const artifact = archive.artifacts.find(
        (candidate) => candidate.clientSessionId === clientSessionId,
      );
      const existing = outbox.entries.find(
        (entry) => entry.clientSessionId === clientSessionId,
      );
      if (artifact === undefined || existing === undefined) {
        throw new LocalRecordingStorageError('INVALID_LOCAL_RECORDING_STORAGE');
      }
      if (existing.status === 'synced') {
        return {
          artifact: structuredClone(artifact),
          entry: structuredClone(existing),
        };
      }

      const syncing = RecordingOutboxEntrySchema.parse({
        ...existing,
        status: 'syncing',
        attemptCount: existing.attemptCount + 1,
        remoteSessionId: null,
        lastAttemptAt: now,
        lastErrorCode: null,
        updatedAt: now,
      });
      await this.saveOutbox(replaceOutboxEntry(outbox, syncing, now));
      return {
        artifact: structuredClone(artifact),
        entry: syncing,
      };
    });
  }

  markSynced(
    clientSessionId: string,
    remoteSessionId: string,
    now: string,
  ): Promise<RecordingOutboxEntry> {
    return this.updateAttemptResult(
      clientSessionId,
      {
        status: 'synced',
        remoteSessionId,
        lastErrorCode: null,
      },
      now,
    );
  }

  markFailed(
    clientSessionId: string,
    errorCode: RecordingSyncErrorCode,
    now: string,
  ): Promise<RecordingOutboxEntry> {
    return this.updateAttemptResult(
      clientSessionId,
      {
        status: 'failed',
        remoteSessionId: null,
        lastErrorCode: errorCode,
      },
      now,
    );
  }

  private async finalizeUnsafe(
    input: RecordingArtifact,
    now: string,
  ): Promise<RecordingOutboxEntry> {
    const artifact = RecordingArtifactSchema.parse(input);
    if (serializedBytes(artifact) > this.limits.maxArtifactBytes) {
      throw new LocalRecordingStorageError(
        'LOCAL_RECORDING_ARTIFACT_TOO_LARGE',
      );
    }

    const archive = await this.loadArchive();
    const existingArtifact = archive.artifacts.find(
      (candidate) => candidate.clientSessionId === artifact.clientSessionId,
    );
    if (
      existingArtifact !== undefined &&
      !exactArtifactMatch(existingArtifact, artifact)
    ) {
      throw new LocalRecordingStorageError('LOCAL_RECORDING_ARTIFACT_CONFLICT');
    }

    if (existingArtifact === undefined) {
      if (archive.artifacts.length >= this.limits.maxArtifacts) {
        throw new LocalRecordingStorageError(
          'LOCAL_RECORDING_ARCHIVE_LIMIT_REACHED',
        );
      }
      await this.saveArchive(
        LocalRecordingArchiveSchema.parse({
          ...archive,
          artifacts: [...archive.artifacts, artifact],
          updatedAt: now,
        }),
      );
      await this.confirmArtifact(artifact);
    }

    return this.ensureOutboxEntry(artifact.clientSessionId, now);
  }

  private async ensureOutboxEntry(
    clientSessionId: string,
    now: string,
  ): Promise<RecordingOutboxEntry> {
    const outbox = await this.loadOutbox();
    const existing = outbox.entries.find(
      (entry) => entry.clientSessionId === clientSessionId,
    );
    if (existing !== undefined) {
      return structuredClone(existing);
    }

    const unsyncedCount = outbox.entries.filter(
      (entry) => entry.status !== 'synced',
    ).length;
    if (unsyncedCount >= this.limits.maxPendingOutboxEntries) {
      throw new LocalRecordingStorageError(
        'LOCAL_RECORDING_OUTBOX_LIMIT_REACHED',
      );
    }
    const entry = RecordingOutboxEntrySchema.parse({
      schemaVersion: 1,
      clientSessionId,
      status: 'pending',
      attemptCount: 0,
      remoteSessionId: null,
      lastAttemptAt: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.saveOutbox(
      LocalRecordingOutboxSchema.parse({
        ...outbox,
        entries: [...outbox.entries, entry],
        updatedAt: now,
      }),
    );
    await this.confirmOutboxEntry(entry);
    return entry;
  }

  private updateAttemptResult(
    clientSessionId: string,
    result:
      | {
          status: 'synced';
          remoteSessionId: string;
          lastErrorCode: null;
        }
      | {
          status: 'failed';
          remoteSessionId: null;
          lastErrorCode: RecordingSyncErrorCode;
        },
    now: string,
  ): Promise<RecordingOutboxEntry> {
    return this.enqueueMutation(async () => {
      const outbox = await this.loadOutbox();
      const existing = outbox.entries.find(
        (entry) => entry.clientSessionId === clientSessionId,
      );
      if (
        existing === undefined ||
        existing.status !== 'syncing' ||
        existing.lastAttemptAt === null
      ) {
        throw new LocalRecordingStorageError('INVALID_LOCAL_RECORDING_STORAGE');
      }
      const updatedEntry = RecordingOutboxEntrySchema.parse({
        ...existing,
        ...result,
        updatedAt: now,
      });
      await this.saveOutbox(replaceOutboxEntry(outbox, updatedEntry, now));
      return updatedEntry;
    });
  }

  private async confirmArtifact(expected: RecordingArtifact): Promise<void> {
    const confirmed = await this.loadArchive();
    const stored = confirmed.artifacts.find(
      (artifact) => artifact.clientSessionId === expected.clientSessionId,
    );
    if (stored === undefined || !exactArtifactMatch(stored, expected)) {
      throw new LocalRecordingStorageError('LOCAL_RECORDING_STORAGE_FAILURE');
    }
  }

  private async confirmOutboxEntry(
    expected: RecordingOutboxEntry,
  ): Promise<void> {
    const confirmed = await this.loadOutbox();
    const stored = confirmed.entries.find(
      (entry) => entry.clientSessionId === expected.clientSessionId,
    );
    if (
      stored === undefined ||
      JSON.stringify(stored) !== JSON.stringify(expected)
    ) {
      throw new LocalRecordingStorageError('LOCAL_RECORDING_STORAGE_FAILURE');
    }
  }

  private async loadArchive(): Promise<LocalRecordingArchive> {
    const value = await this.loadValue(LOCAL_RECORDING_ARCHIVE_STORAGE_KEY);
    if (value === undefined) {
      return initialArchive();
    }
    const parsed = LocalRecordingArchiveSchema.safeParse(value);
    if (!parsed.success) {
      throw new LocalRecordingStorageError('INVALID_LOCAL_RECORDING_STORAGE');
    }
    return parsed.data;
  }

  private async loadOutbox(): Promise<LocalRecordingOutbox> {
    const value = await this.loadValue(LOCAL_RECORDING_OUTBOX_STORAGE_KEY);
    if (value === undefined) {
      return initialOutbox();
    }
    const parsed = LocalRecordingOutboxSchema.safeParse(value);
    if (!parsed.success) {
      throw new LocalRecordingStorageError('INVALID_LOCAL_RECORDING_STORAGE');
    }
    return parsed.data;
  }

  private async loadValue(key: string): Promise<unknown | undefined> {
    try {
      const stored = await this.storage.get(key);
      return stored[key];
    } catch {
      throw new LocalRecordingStorageError('LOCAL_RECORDING_STORAGE_FAILURE');
    }
  }

  private async saveArchive(archive: LocalRecordingArchive): Promise<void> {
    const validated = LocalRecordingArchiveSchema.parse(archive);
    if (serializedBytes(validated) > this.limits.maxArchiveBytes) {
      throw new LocalRecordingStorageError('LOCAL_RECORDING_ARCHIVE_TOO_LARGE');
    }
    await this.saveValue(LOCAL_RECORDING_ARCHIVE_STORAGE_KEY, validated);
  }

  private saveOutbox(outbox: LocalRecordingOutbox): Promise<void> {
    return this.saveValue(
      LOCAL_RECORDING_OUTBOX_STORAGE_KEY,
      LocalRecordingOutboxSchema.parse(outbox),
    );
  }

  private async saveValue(key: string, value: unknown): Promise<void> {
    try {
      await this.storage.set({ [key]: value });
    } catch {
      throw new LocalRecordingStorageError('LOCAL_RECORDING_STORAGE_FAILURE');
    }
  }

  private enqueueMutation<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function replaceOutboxEntry(
  outbox: LocalRecordingOutbox,
  entry: RecordingOutboxEntry,
  now: string,
): LocalRecordingOutbox {
  return LocalRecordingOutboxSchema.parse({
    ...outbox,
    entries: outbox.entries.map((candidate) =>
      candidate.clientSessionId === entry.clientSessionId ? entry : candidate,
    ),
    updatedAt: now,
  });
}
