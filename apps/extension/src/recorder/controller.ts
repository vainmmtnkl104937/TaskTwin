import {
  ContentScriptResponseSchema,
  createRecorderError,
  RecorderCommandSchema,
  type RecorderCommand,
  type RecorderCommandResponse,
  type RecorderErrorCode,
  type RecordingSessionState,
  RecordingSessionStateSchema,
  type RecorderStateChangedNotification,
} from './contracts.js';
import type {
  ActiveTab,
  ActiveTabProvider,
  ContentScriptCoordinator,
  RecorderClock,
  RecorderIdGenerator,
  RecordingStateStore,
} from './ports.js';
import { RecorderIntegrationError } from './ports.js';
import {
  createInitialRecordingState,
  transitionRecordingState,
  type RecorderTransitionEvent,
} from './state-machine.js';

type StateLoadResult =
  | { success: true; state: RecordingSessionState }
  | { success: false; response: RecorderCommandResponse };

function failureResponse(
  code: RecorderErrorCode,
  state: RecordingSessionState | null,
): RecorderCommandResponse {
  return {
    success: false,
    error: createRecorderError(code),
    state,
  };
}

function getSupportedOrigin(urlValue: string): string | null {
  try {
    const url = new URL(urlValue);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export class RecorderController {
  constructor(
    private readonly stateStore: RecordingStateStore,
    private readonly activeTabProvider: ActiveTabProvider,
    private readonly contentScript: ContentScriptCoordinator,
    private readonly clock: RecorderClock,
    private readonly idGenerator: RecorderIdGenerator,
  ) {}

  async handle(message: unknown): Promise<RecorderCommandResponse> {
    const commandResult = RecorderCommandSchema.safeParse(message);
    if (!commandResult.success) {
      return failureResponse('UNKNOWN_ERROR', null);
    }

    const loaded = await this.loadState();
    if (!loaded.success) {
      return loaded.response;
    }

    if (commandResult.data.type === 'recorder/get-state') {
      return { success: true, state: loaded.state };
    }

    return this.handleCommand(commandResult.data, loaded.state);
  }

  private async loadState(): Promise<StateLoadResult> {
    let storedState: unknown | undefined;
    try {
      storedState = await this.stateStore.load();
    } catch {
      return {
        success: false,
        response: failureResponse('STORAGE_FAILURE', null),
      };
    }

    if (storedState === undefined) {
      const initialState = createInitialRecordingState(this.clock.now());
      try {
        await this.stateStore.save(initialState);
      } catch {
        return {
          success: false,
          response: failureResponse('STORAGE_FAILURE', null),
        };
      }
      return { success: true, state: initialState };
    }

    const parsedState = RecordingSessionStateSchema.safeParse(storedState);
    if (!parsedState.success) {
      return {
        success: false,
        response: failureResponse('STORAGE_FAILURE', null),
      };
    }

    if (
      parsedState.data.status === 'starting' ||
      parsedState.data.status === 'stopping'
    ) {
      const interrupted = transitionRecordingState(
        parsedState.data,
        {
          type: 'fail',
          error: createRecorderError('UNKNOWN_ERROR'),
        },
        this.clock.now(),
      );
      if (!interrupted.success) {
        return {
          success: false,
          response: failureResponse('UNKNOWN_ERROR', parsedState.data),
        };
      }
      try {
        await this.stateStore.save(interrupted.state);
      } catch {
        return {
          success: false,
          response: failureResponse('STORAGE_FAILURE', parsedState.data),
        };
      }
      return { success: true, state: interrupted.state };
    }

    return { success: true, state: parsedState.data };
  }

  private handleCommand(
    command: Exclude<RecorderCommand, { type: 'recorder/get-state' }>,
    state: RecordingSessionState,
  ): Promise<RecorderCommandResponse> {
    switch (command.type) {
      case 'recorder/start':
        return this.start(state);
      case 'recorder/pause':
        return this.changeActiveState(state, { type: 'pause' });
      case 'recorder/resume':
        return this.changeActiveState(state, { type: 'resume' });
      case 'recorder/stop':
        return this.stop(state);
      case 'recorder/reset':
        return this.reset(state);
    }
  }

  private async start(
    initialState: RecordingSessionState,
  ): Promise<RecorderCommandResponse> {
    const starting = await this.persistTransition(initialState, {
      type: 'start',
      sessionId: this.idGenerator.createSessionId(),
    });
    if (!starting.success) {
      return starting.response;
    }

    let activeTab: ActiveTab | null;
    try {
      activeTab = await this.activeTabProvider.getActiveTab();
    } catch {
      return this.failOperation(starting.state, 'UNKNOWN_ERROR');
    }

    if (activeTab === null) {
      return this.failOperation(starting.state, 'NO_ACTIVE_TAB');
    }

    if (activeTab.url === undefined) {
      return this.failOperation(starting.state, 'MISSING_PERMISSION');
    }

    const targetOrigin = getSupportedOrigin(activeTab.url);
    if (targetOrigin === null) {
      return this.failOperation(starting.state, 'UNSUPPORTED_PAGE');
    }

    try {
      await this.contentScript.prepare(activeTab.id);
    } catch (error: unknown) {
      return this.failOperation(
        starting.state,
        this.integrationErrorCode(error, 'MISSING_PERMISSION'),
      );
    }

    const recording = await this.persistTransition(starting.state, {
      type: 'complete-start',
      activeTabId: activeTab.id,
      activeWindowId: activeTab.windowId,
      targetOrigin,
    });
    if (!recording.success) {
      return recording.response;
    }

    const notificationError = await this.notifyState(recording.state);
    if (notificationError !== null) {
      return this.failOperation(recording.state, notificationError);
    }

    return { success: true, state: recording.state };
  }

  private async changeActiveState(
    initialState: RecordingSessionState,
    event: Extract<RecorderTransitionEvent, { type: 'pause' | 'resume' }>,
  ): Promise<RecorderCommandResponse> {
    const changed = await this.persistTransition(initialState, event);
    if (!changed.success) {
      return changed.response;
    }

    const notificationError = await this.notifyState(changed.state);
    if (notificationError !== null) {
      return this.failOperation(changed.state, notificationError);
    }

    return { success: true, state: changed.state };
  }

  private async stop(
    initialState: RecordingSessionState,
  ): Promise<RecorderCommandResponse> {
    const stopping = await this.persistTransition(initialState, {
      type: 'stop',
    });
    if (!stopping.success) {
      return stopping.response;
    }

    const notificationError = await this.notifyState(stopping.state);
    if (notificationError !== null) {
      return this.failOperation(stopping.state, notificationError);
    }

    const targetTabId = stopping.state.activeTabId;
    const idle = await this.persistTransition(stopping.state, {
      type: 'complete-stop',
    });
    if (!idle.success) {
      return idle.response;
    }

    if (targetTabId !== null) {
      const finalNotificationError = await this.notifyTab(
        targetTabId,
        idle.state,
      );
      if (finalNotificationError !== null) {
        return failureResponse(finalNotificationError, idle.state);
      }
    }

    return { success: true, state: idle.state };
  }

  private async reset(
    initialState: RecordingSessionState,
  ): Promise<RecorderCommandResponse> {
    const targetTabId = initialState.activeTabId;
    const idle = await this.persistTransition(initialState, { type: 'reset' });
    if (!idle.success) {
      return idle.response;
    }

    if (targetTabId !== null) {
      const notificationError = await this.notifyTab(targetTabId, idle.state);
      if (notificationError !== null) {
        return failureResponse(notificationError, idle.state);
      }
    }

    return { success: true, state: idle.state };
  }

  private async persistTransition(
    initialState: RecordingSessionState,
    event: RecorderTransitionEvent,
  ): Promise<
    | { success: true; state: RecordingSessionState }
    | { success: false; response: RecorderCommandResponse }
  > {
    const transition = transitionRecordingState(
      initialState,
      event,
      this.clock.now(),
    );
    if (!transition.success) {
      return {
        success: false,
        response: {
          success: false,
          error: transition.error,
          state: initialState,
        },
      };
    }

    try {
      await this.stateStore.save(transition.state);
    } catch {
      return {
        success: false,
        response: failureResponse('STORAGE_FAILURE', initialState),
      };
    }

    return { success: true, state: transition.state };
  }

  private async failOperation(
    state: RecordingSessionState,
    code: RecorderErrorCode,
  ): Promise<RecorderCommandResponse> {
    const failed = await this.persistTransition(state, {
      type: 'fail',
      error: createRecorderError(code),
    });
    if (!failed.success) {
      return failed.response;
    }

    return failureResponse(code, failed.state);
  }

  private notifyState(
    state: RecordingSessionState,
  ): Promise<RecorderErrorCode | null> {
    return state.activeTabId === null
      ? Promise.resolve(null)
      : this.notifyTab(state.activeTabId, state);
  }

  private async notifyTab(
    tabId: number,
    state: RecordingSessionState,
  ): Promise<RecorderErrorCode | null> {
    const notification: RecorderStateChangedNotification = {
      type: 'recorder/state-changed',
      state,
    };

    try {
      const response = await this.contentScript.notify(tabId, notification);
      const parsedResponse = ContentScriptResponseSchema.safeParse(response);
      if (
        !parsedResponse.success ||
        !parsedResponse.data.success ||
        parsedResponse.data.receivedStatus !== state.status
      ) {
        return 'CONTENT_SCRIPT_UNAVAILABLE';
      }
      return null;
    } catch (error: unknown) {
      return this.integrationErrorCode(error, 'CONTENT_SCRIPT_UNAVAILABLE');
    }
  }

  private integrationErrorCode(
    error: unknown,
    fallback: RecorderErrorCode,
  ): RecorderErrorCode {
    return error instanceof RecorderIntegrationError ? error.code : fallback;
  }
}
