import {
  createRecorderError,
  RECORDER_ERROR_MESSAGES,
  RecorderCommandResponseSchema,
  type RecorderCommand,
  type RecorderError,
  type RecorderStatus,
  type RecordingSessionState,
} from './recorder/contracts.js';

export type PopupAction = 'start' | 'pause' | 'resume' | 'stop' | 'reset';

export interface PopupPresentation {
  status: RecorderStatus;
  enabledActions: readonly PopupAction[];
  errorMessage: string | null;
  pending: boolean;
}

export interface PopupView {
  bindAction(action: PopupAction, handler: () => void | Promise<void>): void;
  render(presentation: PopupPresentation): void;
}

export interface PopupMessenger {
  send(command: RecorderCommand): Promise<unknown>;
}

const ACTION_COMMANDS = {
  start: { type: 'recorder/start' },
  pause: { type: 'recorder/pause' },
  resume: { type: 'recorder/resume' },
  stop: { type: 'recorder/stop' },
  reset: { type: 'recorder/reset' },
} as const satisfies Record<PopupAction, RecorderCommand>;

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
    pending: options?.pendingStatus !== undefined,
  };
}

export class PopupController {
  private currentState: RecordingSessionState | null = null;

  constructor(
    private readonly messenger: PopupMessenger,
    private readonly view: PopupView,
  ) {
    for (const action of Object.keys(ACTION_COMMANDS) as PopupAction[]) {
      this.view.bindAction(action, () => this.dispatch(action));
    }
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
      createPopupPresentation(this.currentState, {
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

    const parsedResponse = RecorderCommandResponseSchema.safeParse(response);
    if (!parsedResponse.success) {
      this.renderTransportError();
      return;
    }

    if (parsedResponse.data.state !== null) {
      this.currentState = parsedResponse.data.state;
      this.view.render(
        createPopupPresentation(this.currentState, {
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
        pending: false,
      });
      return;
    }

    this.view.render(
      createPopupPresentation(this.currentState, {
        responseError: error,
      }),
    );
  }
}
