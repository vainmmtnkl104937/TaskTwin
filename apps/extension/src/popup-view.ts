import type {
  PopupAction,
  PopupPresentation,
  PopupView,
} from './popup-controller.js';

const STATUS_LABELS = {
  idle: 'Idle',
  starting: 'Starting',
  recording: 'Recording',
  paused: 'Paused',
  stopping: 'Stopping',
  error: 'Error',
} as const;

export class DomPopupView implements PopupView {
  private readonly statusElement: HTMLElement;
  private readonly errorElement: HTMLElement;
  private readonly buttons: ReadonlyMap<PopupAction, HTMLButtonElement>;

  constructor(document: Document) {
    const statusElement = document.querySelector<HTMLElement>(
      '[data-recorder-status]',
    );
    const errorElement = document.querySelector<HTMLElement>(
      '[data-recorder-error]',
    );
    const buttons = new Map<PopupAction, HTMLButtonElement>();

    for (const action of [
      'start',
      'pause',
      'resume',
      'stop',
      'reset',
    ] as const) {
      const button = document.querySelector<HTMLButtonElement>(
        `[data-recorder-action="${action}"]`,
      );
      if (button === null) {
        throw new Error(`Recorder ${action} button is missing.`);
      }
      buttons.set(action, button);
    }

    if (statusElement === null || errorElement === null) {
      throw new Error('Recorder popup status elements are missing.');
    }

    this.statusElement = statusElement;
    this.errorElement = errorElement;
    this.buttons = buttons;
  }

  bindAction(action: PopupAction, handler: () => void | Promise<void>): void {
    this.getButton(action).addEventListener('click', () => {
      void handler();
    });
  }

  render(presentation: PopupPresentation): void {
    this.statusElement.textContent = STATUS_LABELS[presentation.status];
    this.statusElement.dataset.status = presentation.status;

    for (const [action, button] of this.buttons) {
      button.disabled = !presentation.enabledActions.includes(action);
    }

    this.errorElement.textContent = presentation.errorMessage ?? '';
    this.errorElement.hidden = presentation.errorMessage === null;
  }

  private getButton(action: PopupAction): HTMLButtonElement {
    const button = this.buttons.get(action);
    if (button === undefined) {
      throw new Error(`Recorder ${action} button is missing.`);
    }
    return button;
  }
}
