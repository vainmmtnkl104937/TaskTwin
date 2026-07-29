import {
  createRecorderError,
  RECORDER_ERROR_MESSAGES,
  type RecorderCommand,
  type RecorderError,
  type RecorderStatus,
  type RecordingSessionState,
} from './recorder/contracts.js';
import {
  RecorderPopupResponseSchema,
  TimelineSummaryChangedNotificationSchema,
  type RecordingEventType,
  type RecordingTimelineSummary,
} from './recorder/event-contracts.js';

export type PopupAction = 'start' | 'pause' | 'resume' | 'stop' | 'reset';

export interface PopupPresentation {
  status: RecorderStatus;
  enabledActions: readonly PopupAction[];
  errorMessage: string | null;
  eventCount: number;
  latestEventSummary: string;
  pending: boolean;
}

export interface PopupView {
  bindAction(action: PopupAction, handler: () => void | Promise<void>): void;
  render(presentation: PopupPresentation): void;
}

export interface PopupMessenger {
  send(command: RecorderCommand): Promise<unknown>;
  subscribe(handler: (message: unknown) => void): void;
}

const ACTION_COMMANDS = {
  start: { type: 'recorder/start' },
  pause: { type: 'recorder/pause' },
  resume: { type: 'recorder/resume' },
  stop: { type: 'recorder/stop' },
  reset: { type: 'recorder/reset' },
} as const satisfies Record<PopupAction, RecorderCommand>;

const EVENT_SUMMARIES = {
  click: 'Click',
  'text-input': 'Text input',
  select: 'Select change',
  checkbox: 'Checkbox change',
  radio: 'Radio change',
} as const satisfies Record<RecordingEventType, string>;

export function getValidPopupActions(
  status: RecorderStatus,
): readonly PopupAction[] {
  switch (status) {
    case 'idle':
      return ['start'];
    case 'recording':
      return ['pause', 'stop'];
    case 'paused':
      return ['resume', 'stop'];
    case 'error':
      return ['reset'];
    case 'starting':
    case 'stopping':
      return [];
  }
}

export function createPopupPresentation(
  state: RecordingSessionState,
  timelineSummary: RecordingTimelineSummary,
  options?: {
    pendingStatus?: Extract<RecorderStatus, 'starting' | 'stopping'>;
    responseError?: RecorderError;
  },
): PopupPresentation {
  const status = options?.pendingStatus ?? state.status;
  const error = options?.responseError ?? state.error;

  return {
    status,
    enabledActions:
      options?.pendingStatus === undefined ? getValidPopupActions(status) : [],
    errorMessage: error === null ? null : RECORDER_ERROR_MESSAGES[error.code],
    eventCount: timelineSummary.eventCount,
    latestEventSummary:
      timelineSummary.latestEventType === null
        ? 'None'
        : EVENT_SUMMARIES[timelineSummary.latestEventType],
    pending: options?.pendingStatus !== undefined,
  };
}

export class PopupController {
  private currentState: RecordingSessionState | null = null;
  private timelineSummary: RecordingTimelineSummary = {
    eventCount: 0,
    latestEventType: null,
  };

  constructor(
    private readonly messenger: PopupMessenger,
    private readonly view: PopupView,
  ) {
    for (const action of Object.keys(ACTION_COMMANDS) as PopupAction[]) {
      this.view.bindAction(action, () => this.dispatch(action));
    }
    this.messenger.subscribe((message) => this.receiveNotification(message));
  }

  async initialize(): Promise<void> {
    await this.send({ type: 'recorder/get-state' });
  }

  async dispatch(action: PopupAction): Promise<void> {
    if (
      this.currentState === null ||
      !getValidPopupActions(this.currentState.status).includes(action)
    ) {
      return;
    }

    const pendingStatus =
      action === 'start'
        ? 'starting'
        : action === 'stop'
          ? 'stopping'
          : undefined;
    this.view.render(
      createPopupPresentation(this.currentState, this.timelineSummary, {
        ...(pendingStatus === undefined ? {} : { pendingStatus }),
      }),
    );

    await this.send(ACTION_COMMANDS[action]);
  }

  private async send(command: RecorderCommand): Promise<void> {
    let response: unknown;
    try {
      response = await this.messenger.send(command);
    } catch {
      this.renderTransportError();
      return;
    }

    const parsedResponse = RecorderPopupResponseSchema.safeParse(response);
    if (!parsedResponse.success) {
      this.renderTransportError();
      return;
    }

    if (parsedResponse.data.state !== null) {
      this.currentState = parsedResponse.data.state;
      this.timelineSummary = parsedResponse.data.timelineSummary;
      this.view.render(
        createPopupPresentation(this.currentState, this.timelineSummary, {
          ...(parsedResponse.data.success
            ? {}
            : { responseError: parsedResponse.data.error }),
        }),
      );
      return;
    }

    this.renderTransportError();
  }

  private renderTransportError(): void {
    const error = createRecorderError('UNKNOWN_ERROR');
    if (this.currentState === null) {
      this.view.render({
        status: 'error',
        enabledActions: [],
        errorMessage: RECORDER_ERROR_MESSAGES[error.code],
        eventCount: this.timelineSummary.eventCount,
        latestEventSummary:
          this.timelineSummary.latestEventType === null
            ? 'None'
            : EVENT_SUMMARIES[this.timelineSummary.latestEventType],
        pending: false,
      });
      return;
    }

    this.view.render(
      createPopupPresentation(this.currentState, this.timelineSummary, {
        responseError: error,
      }),
    );
  }

  private receiveNotification(message: unknown): void {
    const notification =
      TimelineSummaryChangedNotificationSchema.safeParse(message);
    if (!notification.success || this.currentState === null) {
      return;
    }

    this.timelineSummary = notification.data.summary;
    this.view.render(
      createPopupPresentation(this.currentState, this.timelineSummary),
    );
  }
}
