import {
  ContentScriptResponseSchema,
  createRecorderError,
  RecorderStateChangedNotificationSchema,
  type ContentScriptResponse,
  type RecorderStatus,
} from './recorder/contracts.js';
import {
  FlushPendingNotificationSchema,
  FlushPendingResponseSchema,
  type FlushPendingResponse,
} from './recorder/event-contracts.js';

export interface EventCaptureLifecycle {
  start(): void;
  stopWithoutFlush(): void;
  suspendAndFlush(): Promise<boolean>;
  isCapturing(): boolean;
}

export class ContentScriptController {
  private currentStatus: RecorderStatus = 'idle';
  private currentSessionId: string | null = null;

  constructor(private readonly capture: EventCaptureLifecycle) {}

  async handle(
    message: unknown,
  ): Promise<ContentScriptResponse | FlushPendingResponse> {
    const stateNotification =
      RecorderStateChangedNotificationSchema.safeParse(message);

    if (stateNotification.success) {
      this.currentStatus = stateNotification.data.state.status;
      this.currentSessionId = stateNotification.data.state.sessionId;

      if (this.currentStatus === 'recording') {
        this.capture.start();
      } else {
        this.capture.stopWithoutFlush();
      }

      return ContentScriptResponseSchema.parse({
        success: true,
        receivedStatus: this.currentStatus,
      });
    }

    const flushNotification = FlushPendingNotificationSchema.safeParse(message);
    if (
      !flushNotification.success ||
      flushNotification.data.sessionId !== this.currentSessionId ||
      (this.currentStatus !== 'recording' && this.currentStatus !== 'paused')
    ) {
      return FlushPendingResponseSchema.parse({
        success: false,
        error: createRecorderError('EVENT_REJECTED'),
      });
    }

    const flushed = await this.capture.suspendAndFlush();
    return flushed
      ? FlushPendingResponseSchema.parse({
          success: true,
          flushed: true,
        })
      : FlushPendingResponseSchema.parse({
          success: false,
          error: createRecorderError('EVENT_REJECTED'),
        });
  }

  isRecorderActive(): boolean {
    return this.capture.isCapturing();
  }

  getStatus(): RecorderStatus {
    return this.currentStatus;
  }
}
