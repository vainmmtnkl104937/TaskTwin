import { describe, expect, it } from 'vitest';

import {
  createInitialRecordingState,
  transitionRecordingState,
} from '../src/recorder/state-machine.js';
import type { RecordingSessionState } from '../src/recorder/contracts.js';

const firstTimestamp = '2026-07-29T10:00:00.000Z';
const secondTimestamp = '2026-07-29T10:00:01.000Z';
const sessionId = '57a1a7d4-5ada-4bc8-ac17-10c84746a567';

function expectSuccessfulState(
  result: ReturnType<typeof transitionRecordingState>,
): RecordingSessionState {
  if (!result.success) {
    throw new Error(`Expected a successful transition: ${result.error.code}`);
  }
  return result.state;
}

function createRecordingState(): RecordingSessionState {
  const idle = createInitialRecordingState(firstTimestamp);
  const starting = expectSuccessfulState(
    transitionRecordingState(
      idle,
      { type: 'start', sessionId },
      firstTimestamp,
    ),
  );
  return expectSuccessfulState(
    transitionRecordingState(
      starting,
      {
        type: 'complete-start',
        activeTabId: 42,
        activeWindowId: 7,
        targetOrigin: 'https://example.com',
      },
      secondTimestamp,
    ),
  );
}

describe('recording state machine', () => {
  it('moves from idle through starting to recording', () => {
    const recording = createRecordingState();

    expect(recording).toMatchObject({
      status: 'recording',
      sessionId,
      activeTabId: 42,
      activeWindowId: 7,
      targetOrigin: 'https://example.com',
      startedAt: secondTimestamp,
    });
  });

  it('moves from recording to paused and back to recording', () => {
    const recording = createRecordingState();
    const paused = expectSuccessfulState(
      transitionRecordingState(recording, { type: 'pause' }, secondTimestamp),
    );
    const resumed = expectSuccessfulState(
      transitionRecordingState(paused, { type: 'resume' }, secondTimestamp),
    );

    expect(paused.status).toBe('paused');
    expect(paused.pausedAt).toBe(secondTimestamp);
    expect(resumed.status).toBe('recording');
    expect(resumed.pausedAt).toBeNull();
  });

  it.each(['recording', 'paused'] as const)(
    'moves from %s through stopping to idle',
    (sourceStatus) => {
      const recording = createRecordingState();
      const source =
        sourceStatus === 'paused'
          ? expectSuccessfulState(
              transitionRecordingState(
                recording,
                { type: 'pause' },
                secondTimestamp,
              ),
            )
          : recording;
      const stopping = expectSuccessfulState(
        transitionRecordingState(source, { type: 'stop' }, secondTimestamp),
      );
      const idle = expectSuccessfulState(
        transitionRecordingState(
          stopping,
          { type: 'complete-stop' },
          secondTimestamp,
        ),
      );

      expect(stopping.status).toBe('stopping');
      expect(idle).toMatchObject({
        status: 'idle',
        sessionId: null,
        activeTabId: null,
        targetOrigin: null,
      });
    },
  );

  it('moves from error to idle through reset', () => {
    const recording = createRecordingState();
    const error = expectSuccessfulState(
      transitionRecordingState(
        recording,
        {
          type: 'fail',
          error: {
            code: 'CONTENT_SCRIPT_UNAVAILABLE',
            message: 'TaskTwin could not communicate with the selected page.',
          },
        },
        secondTimestamp,
      ),
    );
    const idle = expectSuccessfulState(
      transitionRecordingState(error, { type: 'reset' }, secondTimestamp),
    );

    expect(error.status).toBe('error');
    expect(idle.status).toBe('idle');
    expect(idle.error).toBeNull();
  });

  it('rejects invalid transitions without changing the input state', () => {
    const idle = createInitialRecordingState(firstTimestamp);
    const snapshot = structuredClone(idle);
    const result = transitionRecordingState(
      idle,
      { type: 'pause' },
      secondTimestamp,
    );

    expect(result).toEqual({
      success: false,
      error: {
        code: 'INVALID_TRANSITION',
        message: 'That recorder action is not available right now.',
      },
    });
    expect(idle).toEqual(snapshot);
  });
});
