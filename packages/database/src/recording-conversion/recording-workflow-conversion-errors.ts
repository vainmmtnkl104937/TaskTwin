export type RecordingWorkflowConversionRepositoryErrorCode =
  | 'INVALID_CONVERSION_INPUT'
  | 'RECORDING_NOT_FOUND'
  | 'RECORDING_NOT_COMPLETED'
  | 'CONVERSION_CONFLICT'
  | 'PERSISTED_CONVERSION_INVALID'
  | 'SERIALIZATION_FAILURE';

const ERROR_MESSAGES = {
  INVALID_CONVERSION_INPUT: 'The recording conversion input is invalid.',
  RECORDING_NOT_FOUND: 'The recording session is unavailable.',
  RECORDING_NOT_COMPLETED: 'The recording session is not completed.',
  CONVERSION_CONFLICT: 'The recording conversion conflicts with stored data.',
  PERSISTED_CONVERSION_INVALID: 'The stored recording conversion is invalid.',
  SERIALIZATION_FAILURE:
    'The recording conversion operation could not be serialized.',
} as const satisfies Record<
  RecordingWorkflowConversionRepositoryErrorCode,
  string
>;

export class RecordingWorkflowConversionRepositoryError extends Error {
  constructor(
    public readonly code: RecordingWorkflowConversionRepositoryErrorCode,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'RecordingWorkflowConversionRepositoryError';
  }
}
