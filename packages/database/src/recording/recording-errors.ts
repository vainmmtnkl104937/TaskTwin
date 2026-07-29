export type RecordingRepositoryErrorCode =
  | 'INVALID_RECORDING_INPUT'
  | 'WORKSPACE_NOT_FOUND'
  | 'RECORDING_NOT_FOUND'
  | 'RECORDING_CONFLICT'
  | 'BATCH_CONFLICT'
  | 'SESSION_COMPLETED'
  | 'INCOMPLETE_RECORDING'
  | 'PERSISTED_RECORDING_INVALID'
  | 'SERIALIZATION_FAILURE';

const ERROR_MESSAGES = {
  INVALID_RECORDING_INPUT: 'The recording input is invalid.',
  WORKSPACE_NOT_FOUND: 'The workspace is unavailable.',
  RECORDING_NOT_FOUND: 'The recording session is unavailable.',
  RECORDING_CONFLICT: 'The recording session conflicts with stored data.',
  BATCH_CONFLICT: 'The recording batch conflicts with stored data.',
  SESSION_COMPLETED: 'The recording session is already completed.',
  INCOMPLETE_RECORDING: 'The recording session is incomplete.',
  PERSISTED_RECORDING_INVALID: 'The stored recording data is invalid.',
  SERIALIZATION_FAILURE: 'The recording operation could not be serialized.',
} as const satisfies Record<RecordingRepositoryErrorCode, string>;

export class RecordingRepositoryError extends Error {
  constructor(public readonly code: RecordingRepositoryErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'RecordingRepositoryError';
  }
}
