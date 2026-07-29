import './popup.css';

import type { RecorderCommand } from './recorder/contracts.js';
import { PopupController, type PopupMessenger } from './popup-controller.js';
import { DomPopupView } from './popup-view.js';

class ChromePopupMessenger implements PopupMessenger {
  send(command: RecorderCommand): Promise<unknown> {
    return chrome.runtime.sendMessage(command);
  }

  subscribe(handler: (message: unknown) => void): void {
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (sender.id === chrome.runtime.id && sender.tab === undefined) {
        handler(message);
      }
      return false;
    });
  }
}

const popupController = new PopupController(
  new ChromePopupMessenger(),
  new DomPopupView(document),
);
void popupController.initialize();
