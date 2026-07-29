import {
  DEFAULT_PRIVACY_SETTINGS,
  type PrivacySettings,
} from '@tasktwin/privacy-engine';

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
  configurePrivacy(settings: PrivacySettings): void;
  start(): void;
  stopWithoutFlush(): void;
  suspendAndFlush(): Promise<boolean>;
  isCapturing(): boolean;
}

export interface PrivacySettingsStore {
  load(): Promise<PrivacySettings>;
}

export interface PrivacyPreviewLifecycle {
  activate(settings: PrivacySettings): void;
  clear(): void;
}

const defaultPrivacySettingsStore: PrivacySettingsStore = {
  load: () => Promise.resolve(structuredClone(DEFAULT_PRIVACY_SETTINGS)),
};

const noPrivacyPreview: PrivacyPreviewLifecycle = {
  activate: () => undefined,
  clear: () => undefined,
};

export class ContentScriptController {
  private currentStatus: RecorderStatus = 'idle';
  private currentSessionId: string | null = null;

  constructor(
    private readonly capture: EventCaptureLifecycle,
    private readonly privacySettings: PrivacySettingsStore = defaultPrivacySettingsStore,
    private readonly privacyPreview: PrivacyPreviewLifecycle = noPrivacyPreview,
  ) {}

  async handle(
    message: unknown,
  ): Promise<ContentScriptResponse | FlushPendingResponse> {
    const stateNotification =
      RecorderStateChangedNotificationSchema.safeParse(message);

    if (stateNotification.success) {
      const nextStatus = stateNotification.data.state.status;
      const nextSessionId = stateNotification.data.state.sessionId;

      if (nextStatus === 'recording') {
        let settings: PrivacySettings;
        try {
          settings = await this.privacySettings.load();
        } catch {
          return ContentScriptResponseSchema.parse({
            success: false,
            error: createRecorderError('STORAGE_FAILURE'),
          });
        }
        this.capture.configurePrivacy(settings);
        this.capture.start();
        this.privacyPreview.activate(settings);
      } else {
        this.capture.stopWithoutFlush();
        this.privacyPreview.clear();
      }

      this.currentStatus = nextStatus;
      this.currentSessionId = nextSessionId;

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
