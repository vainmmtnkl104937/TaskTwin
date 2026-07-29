import { ContentScriptController } from './content-script-controller.js';

interface TaskTwinContentScriptGlobal {
  taskTwinRecorderContentScript?: ContentScriptController;
}

const contentScriptGlobal = globalThis as typeof globalThis &
  TaskTwinContentScriptGlobal;

if (contentScriptGlobal.taskTwinRecorderContentScript === undefined) {
  const controller = new ContentScriptController();
  contentScriptGlobal.taskTwinRecorderContentScript = controller;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) {
      return false;
    }

    sendResponse(controller.handle(message));
    return false;
  });
}
