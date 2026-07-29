import { describe, expect, it } from 'vitest';

import {
  ChromeLocalRecordingArchive,
  LocalRecordingStorageError,
  type LocalRecordingArchiveLimits,
  type LocalRecordingStorageArea,
} from '../src/recording-artifacts/archive-store.js';
import {
  LOCAL_RECORDING_ARCHIVE_STORAGE_KEY,
  LOCAL_RECORDING_OUTBOX_STORAGE_KEY,
} from '../src/recording-artifacts/constants.js';
import {
  LocalRecordingArchiveSchema,
  LocalRecordingOutboxSchema,
} from '../src/recording-artifacts/contracts.js';
import {
  createBlockedRecordingEvent,
  createRecordingArtifact,
  recordingSessionId,
  recordingTimestamp,
} from './recording-artifact-fixture.js';

class FakeLocalStorage implements LocalRecordingStorageArea {
  readonly values: Record<string, unknown> = {};
  failSet = false;
  failSetForKey: string | null = null;

  get(key: string): Promise<Record<string, unknown>> {
    return Promise.resolve(
      key in this.values ? { [key]: structuredClone(this.values[key]) } : {},
    );
  }

  set(items: Record<string, unknown>): Promise<void> {
    if (
      this.failSet ||
      (this.failSetForKey !== null && this.failSetForKey in items)
    ) {
      return Promise.reject(new Error('storage unavailable'));
    }
    Object.assign(this.values, structuredClone(items));
    return Promise.resolve();
  }
}

const smallLimits: LocalRecordingArchiveLimits = {
  maxArtifacts: 1,
  maxArtifactBytes: 4 * 1024 * 1024,
  maxPendingOutboxEntries: 1,
  maxArchiveBytes: 8 * 1024 * 1024,
};

function secondSessionId(): string {
  return '00000000-0000-4000-8000-000000000002';
}

describe('durable local recording archive', () => {
  it('persists the artifact before creating its pending outbox entry', async () => {
    const storage = new FakeLocalStorage();
    const archive = new ChromeLocalRecordingArchive(storage);
    const artifact = createRecordingArtifact();

    const entry = await archive.finalize(artifact, recordingTimestamp);
    const archiveState = LocalRecordingArchiveSchema.parse(
      storage.values[LOCAL_RECORDING_ARCHIVE_STORAGE_KEY],
    );
    const outboxState = LocalRecordingOutboxSchema.parse(
      storage.values[LOCAL_RECORDING_OUTBOX_STORAGE_KEY],
    );

    expect(entry).toMatchObject({
      clientSessionId: recordingSessionId,
      status: 'pending',
      attemptCount: 0,
    });
    expect(archiveState.artifacts).toEqual([artifact]);
    expect(outboxState.entries).toEqual([entry]);
  });

  it('survives a new archive instance backed by the same local area', async () => {
    const storage = new FakeLocalStorage();
    await new ChromeLocalRecordingArchive(storage).finalize(
      createRecordingArtifact(),
      recordingTimestamp,
    );

    const restored = await new ChromeLocalRecordingArchive(
      storage,
    ).loadArtifact(recordingSessionId);

    expect(restored).toEqual(createRecordingArtifact());
  });

  it('is idempotent without resetting existing outbox state', async () => {
    const storage = new FakeLocalStorage();
    const archive = new ChromeLocalRecordingArchive(storage);
    const artifact = createRecordingArtifact();
    await archive.finalize(artifact, recordingTimestamp);
    await archive.beginSync(recordingSessionId, recordingTimestamp);
    await archive.markSynced(
      recordingSessionId,
      '00000000-0000-4000-8000-000000000099',
      recordingTimestamp,
    );

    const entry = await archive.finalize(artifact, recordingTimestamp);

    expect(entry).toMatchObject({
      status: 'synced',
      attemptCount: 1,
      remoteSessionId: '00000000-0000-4000-8000-000000000099',
    });
  });

  it('rejects a conflicting artifact without overwriting the original', async () => {
    const storage = new FakeLocalStorage();
    const archive = new ChromeLocalRecordingArchive(storage);
    const original = createRecordingArtifact();
    await archive.finalize(original, recordingTimestamp);

    await expect(
      archive.finalize(
        createRecordingArtifact({
          stoppedAt: '2026-07-29T10:00:01.000Z',
        }),
        recordingTimestamp,
      ),
    ).rejects.toMatchObject({
      code: 'LOCAL_RECORDING_ARTIFACT_CONFLICT',
    });
    await expect(archive.loadArtifact(recordingSessionId)).resolves.toEqual(
      original,
    );
  });

  it('fails safely when storage rejects the aggregate write', async () => {
    const storage = new FakeLocalStorage();
    storage.failSet = true;

    await expect(
      new ChromeLocalRecordingArchive(storage).finalize(
        createRecordingArtifact(),
        recordingTimestamp,
      ),
    ).rejects.toEqual(
      new LocalRecordingStorageError('LOCAL_RECORDING_STORAGE_FAILURE'),
    );
    expect(storage.values).toEqual({});
  });

  it('retains a committed artifact when outbox persistence fails and repairs it on retry', async () => {
    const storage = new FakeLocalStorage();
    storage.failSetForKey = LOCAL_RECORDING_OUTBOX_STORAGE_KEY;
    const artifact = createRecordingArtifact();

    await expect(
      new ChromeLocalRecordingArchive(storage).finalize(
        artifact,
        recordingTimestamp,
      ),
    ).rejects.toMatchObject({
      code: 'LOCAL_RECORDING_STORAGE_FAILURE',
    });
    expect(
      LocalRecordingArchiveSchema.parse(
        storage.values[LOCAL_RECORDING_ARCHIVE_STORAGE_KEY],
      ).artifacts,
    ).toEqual([artifact]);
    expect(storage.values[LOCAL_RECORDING_OUTBOX_STORAGE_KEY]).toBeUndefined();

    storage.failSetForKey = null;
    const repaired = await new ChromeLocalRecordingArchive(storage).finalize(
      artifact,
      recordingTimestamp,
    );

    expect(repaired.status).toBe('pending');
    expect(
      LocalRecordingArchiveSchema.parse(
        storage.values[LOCAL_RECORDING_ARCHIVE_STORAGE_KEY],
      ).artifacts,
    ).toEqual([artifact]);
    expect(
      LocalRecordingOutboxSchema.parse(
        storage.values[LOCAL_RECORDING_OUTBOX_STORAGE_KEY],
      ).entries,
    ).toEqual([repaired]);
  });

  it('enforces artifact and pending outbox count without eviction', async () => {
    const storage = new FakeLocalStorage();
    const archive = new ChromeLocalRecordingArchive(storage, smallLimits);
    const original = createRecordingArtifact();
    await archive.finalize(original, recordingTimestamp);

    await expect(
      archive.finalize(
        createRecordingArtifact({
          clientSessionId: secondSessionId(),
          events: [],
        }),
        recordingTimestamp,
      ),
    ).rejects.toMatchObject({
      code: 'LOCAL_RECORDING_ARCHIVE_LIMIT_REACHED',
    });
    await expect(archive.loadArtifact(recordingSessionId)).resolves.toEqual(
      original,
    );
  });

  it('enforces the unsynced outbox limit independently of archive capacity', async () => {
    const storage = new FakeLocalStorage();
    const archive = new ChromeLocalRecordingArchive(storage, {
      ...smallLimits,
      maxArtifacts: 2,
    });
    await archive.finalize(createRecordingArtifact(), recordingTimestamp);

    await expect(
      archive.finalize(
        createRecordingArtifact({
          clientSessionId: secondSessionId(),
          events: [],
        }),
        recordingTimestamp,
      ),
    ).rejects.toMatchObject({
      code: 'LOCAL_RECORDING_OUTBOX_LIMIT_REACHED',
    });
    await expect(
      archive.loadArtifact(secondSessionId()),
    ).resolves.toMatchObject({
      clientSessionId: secondSessionId(),
    });
    await expect(
      archive.loadOutboxEntry(secondSessionId()),
    ).resolves.toBeNull();
  });

  it('enforces serialized artifact and aggregate byte limits', async () => {
    const artifact = createRecordingArtifact();
    const storage = new FakeLocalStorage();
    const artifactLimited = new ChromeLocalRecordingArchive(storage, {
      ...smallLimits,
      maxArtifactBytes: 1,
    });
    await expect(
      artifactLimited.finalize(artifact, recordingTimestamp),
    ).rejects.toMatchObject({
      code: 'LOCAL_RECORDING_ARTIFACT_TOO_LARGE',
    });

    const archiveLimited = new ChromeLocalRecordingArchive(
      new FakeLocalStorage(),
      {
        ...smallLimits,
        maxArchiveBytes: 1,
      },
    );
    await expect(
      archiveLimited.finalize(artifact, recordingTimestamp),
    ).rejects.toMatchObject({
      code: 'LOCAL_RECORDING_ARCHIVE_TOO_LARGE',
    });
  });

  it('never stores a blocked plaintext value in artifact or outbox', async () => {
    const fakeSecret = ['fixture-secret', 'do-not-store'].join('-');
    const artifact = createRecordingArtifact({
      events: [createBlockedRecordingEvent(fakeSecret)],
    });
    const storage = new FakeLocalStorage();

    await new ChromeLocalRecordingArchive(storage).finalize(
      artifact,
      recordingTimestamp,
    );

    expect(JSON.stringify(storage.values)).not.toContain(fakeSecret);
  });
});
