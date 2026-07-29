import {
  ChromeActiveTabProvider,
  ChromeContentScriptCoordinator,
  ChromeSessionRecordingStateStore,
  CryptoRecorderIdGenerator,
  SystemRecorderClock,
} from './chrome/adapters.js';
import {
  createRecorderError,
  RecorderCommandResponseSchema,
  type RecorderCommandResponse,
} from './recorder/contracts.js';
import { RecorderController } from './recorder/controller.js';

const recorderController = new RecorderController(
  new ChromeSessionRecordingStateStore(),
  new ChromeActiveTabProvider(),
  new ChromeContentScriptCoordinator(),
  new SystemRecorderClock(),
  new CryptoRecorderIdGenerator(),
);

let commandQueue: Promise<void> = Promise.resolve();

function unsupportedSenderResponse(): RecorderCommandResponse {
  return {
    success: false,
    error: createRecorderError('UNKNOWN_ERROR'),
    state: null,
  };
}

function enqueueCommand(message: unknown): Promise<RecorderCommandResponse> {
  const result = commandQueue.then(() => recorderController.handle(message));
  commandQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab !== undefined) {
    sendResponse(unsupportedSenderResponse());
    return false;
  }

  void enqueueCommand(message)
    .then((response) => {
      sendResponse(RecorderCommandResponseSchema.parse(response));
    })
    .catch(() => {
      sendResponse({
        success: false,
        error: createRecorderError('UNKNOWN_ERROR'),
        state: null,
      } satisfies RecorderCommandResponse);
    });

  return true;
});
