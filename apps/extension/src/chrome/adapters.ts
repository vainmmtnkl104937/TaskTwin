import {
  type RecorderStateChangedNotification,
  type RecordingSessionState,
} from '../recorder/contracts.js';
import {
  type ActiveTab,
  type ActiveTabProvider,
  type ContentScriptCoordinator,
  type RecorderClock,
  type RecorderIdGenerator,
  RecorderIntegrationError,
  type RecordingStateStore,
} from '../recorder/ports.js';

const RECORDING_STATE_STORAGE_KEY = 'tasktwin.recorder.session.v1';

export class ChromeSessionRecordingStateStore implements RecordingStateStore {
  async load(): Promise<unknown | undefined> {
    const stored = await chrome.storage.session.get(
      RECORDING_STATE_STORAGE_KEY,
    );
    return stored[RECORDING_STATE_STORAGE_KEY];
  }

  save(state: RecordingSessionState): Promise<void> {
    return chrome.storage.session.set({
      [RECORDING_STATE_STORAGE_KEY]: state,
    });
  }
}

export class ChromeActiveTabProvider implements ActiveTabProvider {
  async getActiveTab(): Promise<ActiveTab | null> {
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const tab = tabs[0];

    if (
      tab?.id === undefined ||
      tab.id < 0 ||
      tab.windowId === undefined ||
      tab.windowId < 0
    ) {
      return null;
    }

    return {
      id: tab.id,
      windowId: tab.windowId,
      ...(tab.url === undefined ? {} : { url: tab.url }),
    };
  }
}

export class ChromeContentScriptCoordinator implements ContentScriptCoordinator {
  async prepare(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-script.js'],
      });
    } catch {
      throw new RecorderIntegrationError('MISSING_PERMISSION');
    }
  }

  async notify(
    tabId: number,
    notification: RecorderStateChangedNotification,
  ): Promise<unknown> {
    try {
      return await chrome.tabs.sendMessage(tabId, notification);
    } catch {
      throw new RecorderIntegrationError('CONTENT_SCRIPT_UNAVAILABLE');
    }
  }
}

export class SystemRecorderClock implements RecorderClock {
  now(): string {
    return new Date().toISOString();
  }
}

export class CryptoRecorderIdGenerator implements RecorderIdGenerator {
  createSessionId(): string {
    return crypto.randomUUID();
  }
}
