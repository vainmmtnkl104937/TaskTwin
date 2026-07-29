import {
  browserTrustedEventPolicy,
  EventCaptureController,
  type RecordingCandidateEmitter,
} from './content/event-capture.js';
import { ContentScriptController } from './content-script-controller.js';
import {
  RecordingEventCandidateResponseSchema,
  type RecordingEventCandidate,
} from './recorder/event-contracts.js';

interface TaskTwinContentScriptGlobal {
  taskTwinRecorderContentScript?: ContentScriptController;
}

class ChromeRecordingCandidateEmitter implements RecordingCandidateEmitter {
  async emit(candidate: RecordingEventCandidate): Promise<boolean> {
    const response: unknown = await chrome.runtime.sendMessage({
      type: 'recorder/event-candidate',
      candidate,
    });
    const parsedResponse =
      RecordingEventCandidateResponseSchema.safeParse(response);
    return parsedResponse.success && parsedResponse.data.success;
  }
}

const contentScriptGlobal = globalThis as typeof globalThis &
  TaskTwinContentScriptGlobal;

if (contentScriptGlobal.taskTwinRecorderContentScript === undefined) {
  const capture = new EventCaptureController(
    document,
    new ChromeRecordingCandidateEmitter(),
    { now: () => new Date().toISOString() },
    browserTrustedEventPolicy,
  );
  const controller = new ContentScriptController(capture);
  contentScriptGlobal.taskTwinRecorderContentScript = controller;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) {
      return false;
    }

    void controller
      .handle(message)
      .then(sendResponse)
      .catch(() => {
        sendResponse({
          success: false,
          error: {
            code: 'UNKNOWN_ERROR',
            message: 'TaskTwin could not complete the recorder action.',
          },
        });
      });
    return true;
  });
}
