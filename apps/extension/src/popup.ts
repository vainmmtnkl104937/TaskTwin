import './popup.css';

import type { RecorderCommand } from './recorder/contracts.js';
import { PopupController, type PopupMessenger } from './popup-controller.js';
import { DomPopupView } from './popup-view.js';

class ChromePopupMessenger implements PopupMessenger {
  send(command: RecorderCommand): Promise<unknown> {
    return chrome.runtime.sendMessage(command);
  }
}

const popupController = new PopupController(
  new ChromePopupMessenger(),
  new DomPopupView(document),
);
void popupController.initialize();
