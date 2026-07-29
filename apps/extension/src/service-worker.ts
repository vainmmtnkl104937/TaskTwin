import {
  ChromeActiveTabProvider,
  ChromeContentScriptCoordinator,
  CryptoEventIdGenerator,
  ChromeSessionRecordingStateStore,
  ChromeSessionRecordingTimelineStore,
  CryptoRecorderIdGenerator,
  SystemRecorderClock,
} from './chrome/adapters.js';
import {
  createRecorderError,
  RecorderCommandSchema,
  type RecorderCommandResponse,
  RecordingSessionStateSchema,
} from './recorder/contracts.js';
import { RecorderController } from './recorder/controller.js';
import {
  RecordingEventCandidateMessageSchema,
  RecordingEventCandidateResponseSchema,
  RecorderPopupResponseSchema,
  RecordingTimelineSchema,
  type RecorderPopupResponse,
  type RecordingTimelineSummary,
  TimelineSummaryChangedNotificationSchema,
} from './recorder/event-contracts.js';
import {
  RecordingEventController,
  type RecordingEventSenderContext,
} from './recorder/event-controller.js';
import { summarizeRecordingTimeline } from './recorder/timeline.js';

const stateStore = new ChromeSessionRecordingStateStore();
const timelineStore = new ChromeSessionRecordingTimelineStore();
const contentScript = new ChromeContentScriptCoordinator();
const clock = new SystemRecorderClock();

const recorderController = new RecorderController(
  stateStore,
  timelineStore,
  new ChromeActiveTabProvider(),
  contentScript,
  clock,
  new CryptoRecorderIdGenerator(),
);

const recordingEventController = new RecordingEventController(
  stateStore,
  timelineStore,
  clock,
  new CryptoEventIdGenerator(),
);

let commandQueue: Promise<void> = Promise.resolve();
let eventQueue: Promise<void> = Promise.resolve();

const EMPTY_TIMELINE_SUMMARY: RecordingTimelineSummary = {
  eventCount: 0,
  latestEventType: null,
};

function unsupportedPopupSenderResponse(): RecorderPopupResponse {
  return {
    success: false,
    error: createRecorderError('UNKNOWN_ERROR'),
    state: null,
    timelineSummary: EMPTY_TIMELINE_SUMMARY,
  };
}

function enqueueCommand(message: unknown): Promise<RecorderPopupResponse> {
  const result = commandQueue.then(async () => {
    const response = await recorderController.handle(message);
    return addTimelineSummary(response);
  });
  commandQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function enqueueEvent(message: unknown, sender: RecordingEventSenderContext) {
  const result = eventQueue.then(() =>
    recordingEventController.handle(message, sender),
  );
  eventQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function addTimelineSummary(
  response: RecorderCommandResponse,
): Promise<RecorderPopupResponse> {
  let summary = EMPTY_TIMELINE_SUMMARY;

  try {
    const storedTimeline = await timelineStore.load();
    if (storedTimeline !== undefined) {
      const parsedTimeline = RecordingTimelineSchema.safeParse(storedTimeline);
      if (!parsedTimeline.success) {
        throw new Error('Invalid recording timeline');
      }
      summary = summarizeRecordingTimeline(parsedTimeline.data);
    }
  } catch {
    return {
      success: false,
      error: createRecorderError('STORAGE_FAILURE'),
      state: response.state,
      timelineSummary: EMPTY_TIMELINE_SUMMARY,
    };
  }

  return {
    ...response,
    timelineSummary: summary,
  };
}

function getSenderContext(
  sender: chrome.runtime.MessageSender,
): RecordingEventSenderContext | null {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  const senderLocation = sender.origin ?? sender.url;

  if (
    tabId === undefined ||
    tabId < 0 ||
    frameId === undefined ||
    senderLocation === undefined
  ) {
    return null;
  }

  try {
    const url = new URL(senderLocation);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return {
      tabId,
      frameId,
      origin: url.origin,
    };
  } catch {
    return null;
  }
}

async function notifyStateAfterEventFailure(tabId: number): Promise<void> {
  let storedState: unknown;
  try {
    storedState = await stateStore.load();
  } catch {
    return;
  }

  const parsedState = RecordingSessionStateSchema.safeParse(storedState);
  if (!parsedState.success) {
    return;
  }

  try {
    await contentScript.notify(tabId, {
      type: 'recorder/state-changed',
      state: parsedState.data,
    });
  } catch {
    // The authoritative state is already persisted. No sensitive error is logged.
  }
}

async function broadcastTimelineSummary(
  summary: RecordingTimelineSummary,
): Promise<void> {
  const notification = TimelineSummaryChangedNotificationSchema.parse({
    type: 'recorder/timeline-summary-changed',
    summary,
  });

  try {
    await chrome.runtime.sendMessage(notification);
  } catch {
    // A popup is usually closed while recording. No receiver is expected.
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    sendResponse(unsupportedPopupSenderResponse());
    return false;
  }

  if (RecordingEventCandidateMessageSchema.safeParse(message).success) {
    const context = getSenderContext(sender);
    if (context === null) {
      sendResponse({
        success: false,
        error: createRecorderError('EVENT_REJECTED'),
      });
      return false;
    }

    void enqueueEvent(message, context)
      .then(async (result) => {
        sendResponse(
          RecordingEventCandidateResponseSchema.parse(result.response),
        );

        if (result.response.success) {
          await broadcastTimelineSummary(result.response.summary);
        }
        if (result.stateChanged) {
          await notifyStateAfterEventFailure(context.tabId);
        }
      })
      .catch(() => {
        sendResponse({
          success: false,
          error: createRecorderError('UNKNOWN_ERROR'),
        });
      });

    return true;
  }

  if (
    sender.tab !== undefined ||
    !RecorderCommandSchema.safeParse(message).success
  ) {
    sendResponse(unsupportedPopupSenderResponse());
    return false;
  }

  void enqueueCommand(message)
    .then((response) => {
      sendResponse(RecorderPopupResponseSchema.parse(response));
    })
    .catch(() => {
      sendResponse(unsupportedPopupSenderResponse());
    });

  return true;
});
