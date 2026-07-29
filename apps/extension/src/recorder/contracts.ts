import { z } from 'zod';

export const RecorderStatusSchema = z.enum([
  'idle',
  'starting',
  'recording',
  'paused',
  'stopping',
  'error',
]);

export const RecorderErrorCodeSchema = z.enum([
  'INVALID_TRANSITION',
  'NO_ACTIVE_TAB',
  'UNSUPPORTED_PAGE',
  'MISSING_PERMISSION',
  'STORAGE_FAILURE',
  'CONTENT_SCRIPT_UNAVAILABLE',
  'UNKNOWN_ERROR',
]);

export const RECORDER_ERROR_MESSAGES = {
  INVALID_TRANSITION: 'That recorder action is not available right now.',
  NO_ACTIVE_TAB: 'No active browser tab is available.',
  UNSUPPORTED_PAGE: 'TaskTwin cannot record this type of browser page.',
  MISSING_PERMISSION: 'TaskTwin does not have temporary access to this tab.',
  STORAGE_FAILURE: 'TaskTwin could not save the recorder state.',
  CONTENT_SCRIPT_UNAVAILABLE:
    'TaskTwin could not communicate with the selected page.',
  UNKNOWN_ERROR: 'TaskTwin could not complete the recorder action.',
} as const satisfies Record<RecorderErrorCode, string>;

export const RecorderErrorSchema = z.strictObject({
  code: RecorderErrorCodeSchema,
  message: z.string().trim().min(1).max(160),
});

const NullableTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .nullable();

const TargetOriginSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value
    );
  }, 'Must be an HTTP or HTTPS origin without a path.');

const RecordingSessionStateObjectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  status: RecorderStatusSchema,
  sessionId: z.string().uuid().nullable(),
  activeTabId: z.number().int().nonnegative().nullable(),
  activeWindowId: z.number().int().nonnegative().nullable(),
  targetOrigin: TargetOriginSchema.nullable(),
  startedAt: NullableTimestampSchema,
  pausedAt: NullableTimestampSchema,
  lastUpdatedAt: z.string().datetime({ offset: true }),
  error: RecorderErrorSchema.nullable(),
});

type StateField = keyof z.infer<typeof RecordingSessionStateObjectSchema>;

function addStateIssue(
  context: z.RefinementCtx,
  field: StateField,
  message: string,
): void {
  context.addIssue({
    code: 'custom',
    path: [field],
    message,
  });
}

export const RecordingSessionStateSchema =
  RecordingSessionStateObjectSchema.superRefine((state, context) => {
    const sessionFields = [
      'sessionId',
      'activeTabId',
      'activeWindowId',
      'targetOrigin',
      'startedAt',
      'pausedAt',
    ] as const;

    if (state.status === 'idle') {
      for (const field of sessionFields) {
        if (state[field] !== null) {
          addStateIssue(context, field, 'Must be null while idle.');
        }
      }
      if (state.error !== null) {
        addStateIssue(context, 'error', 'Must be null while idle.');
      }
      return;
    }

    if (state.status === 'starting') {
      if (state.sessionId === null) {
        addStateIssue(context, 'sessionId', 'Required while starting.');
      }
      for (const field of [
        'activeTabId',
        'activeWindowId',
        'targetOrigin',
        'startedAt',
        'pausedAt',
      ] as const) {
        if (state[field] !== null) {
          addStateIssue(context, field, 'Must be null while starting.');
        }
      }
      if (state.error !== null) {
        addStateIssue(context, 'error', 'Must be null while starting.');
      }
      return;
    }

    if (state.status === 'error') {
      if (state.error === null) {
        addStateIssue(context, 'error', 'Required in the error state.');
      }
      return;
    }

    for (const field of [
      'sessionId',
      'activeTabId',
      'activeWindowId',
      'targetOrigin',
      'startedAt',
    ] as const) {
      if (state[field] === null) {
        addStateIssue(context, field, `Required while ${state.status}.`);
      }
    }
    if (state.error !== null) {
      addStateIssue(context, 'error', `Must be null while ${state.status}.`);
    }

    if (state.status === 'recording' && state.pausedAt !== null) {
      addStateIssue(context, 'pausedAt', 'Must be null while recording.');
    }
    if (state.status === 'paused' && state.pausedAt === null) {
      addStateIssue(context, 'pausedAt', 'Required while paused.');
    }
  });

export const StartRecorderCommandSchema = z.strictObject({
  type: z.literal('recorder/start'),
});
export const PauseRecorderCommandSchema = z.strictObject({
  type: z.literal('recorder/pause'),
});
export const ResumeRecorderCommandSchema = z.strictObject({
  type: z.literal('recorder/resume'),
});
export const StopRecorderCommandSchema = z.strictObject({
  type: z.literal('recorder/stop'),
});
export const ResetRecorderCommandSchema = z.strictObject({
  type: z.literal('recorder/reset'),
});
export const GetRecorderStateCommandSchema = z.strictObject({
  type: z.literal('recorder/get-state'),
});

export const RecorderCommandSchema = z.discriminatedUnion('type', [
  StartRecorderCommandSchema,
  PauseRecorderCommandSchema,
  ResumeRecorderCommandSchema,
  StopRecorderCommandSchema,
  ResetRecorderCommandSchema,
  GetRecorderStateCommandSchema,
]);

export const RecorderStateChangedNotificationSchema = z.strictObject({
  type: z.literal('recorder/state-changed'),
  state: RecordingSessionStateSchema,
});

export const RecorderSuccessResponseSchema = z.strictObject({
  success: z.literal(true),
  state: RecordingSessionStateSchema,
});

export const RecorderFailureResponseSchema = z.strictObject({
  success: z.literal(false),
  error: RecorderErrorSchema,
  state: RecordingSessionStateSchema.nullable(),
});

export const RecorderCommandResponseSchema = z.discriminatedUnion('success', [
  RecorderSuccessResponseSchema,
  RecorderFailureResponseSchema,
]);

export const ContentScriptSuccessResponseSchema = z.strictObject({
  success: z.literal(true),
  receivedStatus: RecorderStatusSchema,
});

export const ContentScriptFailureResponseSchema = z.strictObject({
  success: z.literal(false),
  error: RecorderErrorSchema,
});

export const ContentScriptResponseSchema = z.discriminatedUnion('success', [
  ContentScriptSuccessResponseSchema,
  ContentScriptFailureResponseSchema,
]);

export type RecorderStatus = z.infer<typeof RecorderStatusSchema>;
export type RecorderErrorCode = z.infer<typeof RecorderErrorCodeSchema>;
export type RecorderError = z.infer<typeof RecorderErrorSchema>;
export type RecordingSessionState = z.infer<typeof RecordingSessionStateSchema>;
export type RecorderCommand = z.infer<typeof RecorderCommandSchema>;
export type RecorderStateChangedNotification = z.infer<
  typeof RecorderStateChangedNotificationSchema
>;
export type RecorderCommandResponse = z.infer<
  typeof RecorderCommandResponseSchema
>;
export type ContentScriptResponse = z.infer<typeof ContentScriptResponseSchema>;

export function createRecorderError(code: RecorderErrorCode): RecorderError {
  return {
    code,
    message: RECORDER_ERROR_MESSAGES[code],
  };
}
