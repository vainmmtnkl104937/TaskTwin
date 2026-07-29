import {
  ContentScriptResponseSchema,
  createRecorderError,
  RecorderStateChangedNotificationSchema,
  type ContentScriptResponse,
  type RecorderStatus,
} from './recorder/contracts.js';

export class ContentScriptController {
  private active = false;
  private currentStatus: RecorderStatus = 'idle';

  handle(message: unknown): ContentScriptResponse {
    const notification =
      RecorderStateChangedNotificationSchema.safeParse(message);

    if (!notification.success) {
      return ContentScriptResponseSchema.parse({
        success: false,
        error: createRecorderError('UNKNOWN_ERROR'),
      });
    }

    this.currentStatus = notification.data.state.status;
    this.active =
      this.currentStatus === 'recording' ||
      this.currentStatus === 'paused' ||
      this.currentStatus === 'stopping';

    return ContentScriptResponseSchema.parse({
      success: true,
      receivedStatus: this.currentStatus,
    });
  }

  isRecorderActive(): boolean {
    return this.active;
  }

  getStatus(): RecorderStatus {
    return this.currentStatus;
  }
}
