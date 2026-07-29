import {
  MAX_CONTROL_VALUE_LENGTH,
  MAX_INPUT_VALUE_LENGTH,
  MAX_TARGET_METADATA_LENGTH,
  MAX_TEXT_PREVIEW_LENGTH,
  RecordingEventCandidateSchema,
  RecordingTargetSnapshotSchema,
  type MaskedInputReason,
  type RecordingEventCandidate,
  type RecordingTargetSnapshot,
} from '../recorder/event-contracts.js';

export const INPUT_DEBOUNCE_MS = 500;

const SUPPORTED_TEXT_INPUT_TYPES = new Set([
  'email',
  'number',
  'password',
  'search',
  'tel',
  'text',
  'url',
]);

const TEST_ID_ATTRIBUTES = [
  'data-testid',
  'data-test',
  'data-cy',
  'data-qa',
] as const;

export interface RecordingCandidateEmitter {
  emit(candidate: RecordingEventCandidate): Promise<boolean>;
}

export interface CaptureClock {
  now(): string;
}

export interface TrustedEventPolicy {
  isTrusted(event: Event): boolean;
}

export const browserTrustedEventPolicy: TrustedEventPolicy = {
  isTrusted: (event) => event.isTrusted,
};

interface PendingTextInput {
  candidate: RecordingEventCandidate;
  timer: ReturnType<typeof setTimeout>;
}

function normalizeText(value: string, maximumLength: number): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    return null;
  }
  return normalized.slice(0, maximumLength);
}

function boundedControlValue(value: string): {
  value: string;
  truncated: boolean;
} {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return {
    value: normalized.slice(0, MAX_CONTROL_VALUE_LENGTH),
    truncated: normalized.length > MAX_CONTROL_VALUE_LENGTH,
  };
}

function boundedInputValue(value: string): {
  value: string;
  truncated: boolean;
} {
  return {
    value: value.slice(0, MAX_INPUT_VALUE_LENGTH),
    truncated: value.length > MAX_INPUT_VALUE_LENGTH,
  };
}

function getEventElement(event: Event): Element | null {
  for (const pathEntry of event.composedPath()) {
    if (pathEntry instanceof Element) {
      return pathEntry;
    }
  }
  return event.target instanceof Element ? event.target : null;
}

function getAssociatedControl(element: Element): Element | null {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement
  ) {
    return element;
  }

  const label = element.closest('label');
  return label instanceof HTMLLabelElement ? label.control : null;
}

function isChangeOnlyControl(element: Element): boolean {
  const control = getAssociatedControl(element);
  return (
    control instanceof HTMLSelectElement ||
    (control instanceof HTMLInputElement &&
      (control.type === 'checkbox' || control.type === 'radio'))
  );
}

function findActionableElement(element: Element): HTMLElement | null {
  const actionable = element.closest(
    'button, a[href], input, [role="button"], [role="link"]',
  );
  if (!(actionable instanceof HTMLElement)) {
    return null;
  }

  if (actionable instanceof HTMLButtonElement && actionable.disabled) {
    return null;
  }

  if (actionable.getAttribute('aria-disabled') === 'true') {
    return null;
  }

  if (actionable instanceof HTMLInputElement) {
    if (
      !['button', 'image', 'reset', 'submit'].includes(actionable.type) ||
      actionable.disabled
    ) {
      return null;
    }
  }

  return actionable;
}

function getLabelText(element: Element): string | null {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement
  ) {
    const label = element.labels?.item(0);
    if (label !== null && label !== undefined) {
      return normalizeText(label.textContent ?? '', MAX_TARGET_METADATA_LENGTH);
    }
  }

  const containingLabel = element.closest('label');
  return containingLabel === null
    ? null
    : normalizeText(
        containingLabel.textContent ?? '',
        MAX_TARGET_METADATA_LENGTH,
      );
}

function getAriaLabelledText(element: Element): string | null {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy === null) {
    return null;
  }

  const text = labelledBy
    .split(/\s+/)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ');
  return normalizeText(text, MAX_TARGET_METADATA_LENGTH);
}

export function createTargetSnapshot(
  element: Element,
): RecordingTargetSnapshot {
  const labelText = getLabelText(element);
  const ariaLabel = normalizeText(
    element.getAttribute('aria-label') ?? '',
    MAX_TARGET_METADATA_LENGTH,
  );
  const ariaLabelledText = getAriaLabelledText(element);
  const placeholder =
    element instanceof HTMLInputElement
      ? normalizeText(element.placeholder, MAX_TARGET_METADATA_LENGTH)
      : null;
  const textPreview =
    element instanceof HTMLInputElement || element instanceof HTMLSelectElement
      ? null
      : normalizeText(element.textContent ?? '', MAX_TEXT_PREVIEW_LENGTH);

  return RecordingTargetSnapshotSchema.parse({
    tagName: element.tagName.toLowerCase(),
    inputType:
      element instanceof HTMLInputElement
        ? normalizeText(element.type, MAX_TARGET_METADATA_LENGTH)
        : null,
    role: normalizeText(
      element.getAttribute('role') ?? '',
      MAX_TARGET_METADATA_LENGTH,
    ),
    id: normalizeText(element.id, MAX_TARGET_METADATA_LENGTH),
    name: normalizeText(
      element.getAttribute('name') ?? '',
      MAX_TARGET_METADATA_LENGTH,
    ),
    labelText,
    accessibleName:
      ariaLabel ?? ariaLabelledText ?? labelText ?? placeholder ?? textPreview,
    placeholder,
    textPreview,
    testIdCandidates: TEST_ID_ATTRIBUTES.flatMap((attribute) => {
      const value = normalizeText(
        element.getAttribute(attribute) ?? '',
        MAX_TARGET_METADATA_LENGTH,
      );
      return value === null ? [] : [{ attribute, value }];
    }),
  });
}

function getMaskedReason(input: HTMLInputElement): MaskedInputReason | null {
  if (input.type === 'password') {
    return 'password';
  }

  const autocompleteTokens = (input.getAttribute('autocomplete') ?? '')
    .toLowerCase()
    .split(/\s+/);

  for (const reason of [
    'current-password',
    'new-password',
    'one-time-code',
  ] as const) {
    if (autocompleteTokens.includes(reason)) {
      return reason;
    }
  }

  return null;
}

function createTextInputCandidate(
  input: HTMLInputElement,
  occurredAt: string,
): RecordingEventCandidate {
  const maskedReason = getMaskedReason(input);
  const payload =
    maskedReason === null
      ? {
          masked: false as const,
          maskedReason: null,
          ...boundedInputValue(input.value),
        }
      : {
          masked: true as const,
          maskedReason,
          value: null,
          truncated: false as const,
        };

  return RecordingEventCandidateSchema.parse({
    schemaVersion: 1,
    eventType: 'text-input',
    occurredAt,
    target: createTargetSnapshot(input),
    payload,
  });
}

export class EventCaptureController {
  private capturing = false;
  private readonly pendingInputs = new Map<
    HTMLInputElement,
    PendingTextInput
  >();
  private readonly inFlight = new Set<Promise<boolean>>();

  constructor(
    private readonly document: Document,
    private readonly emitter: RecordingCandidateEmitter,
    private readonly clock: CaptureClock,
    private readonly trustedEvents: TrustedEventPolicy,
  ) {}

  start(): void {
    if (this.capturing) {
      return;
    }

    this.capturing = true;
    this.document.addEventListener('click', this.handleClick, true);
    this.document.addEventListener('input', this.handleInput, true);
    this.document.addEventListener('change', this.handleChange, true);
    this.document.addEventListener('blur', this.handleBlur, true);
  }

  stopWithoutFlush(): void {
    this.detach();
    for (const pending of this.pendingInputs.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingInputs.clear();
  }

  async suspendAndFlush(): Promise<boolean> {
    this.detach();
    for (const input of [...this.pendingInputs.keys()]) {
      this.flushInput(input);
    }

    const results = await Promise.all([...this.inFlight]);
    return results.every(Boolean);
  }

  isCapturing(): boolean {
    return this.capturing;
  }

  private readonly handleClick = (event: Event): void => {
    if (
      !this.capturing ||
      !this.trustedEvents.isTrusted(event) ||
      !(event instanceof MouseEvent) ||
      event.button !== 0
    ) {
      return;
    }

    const target = getEventElement(event);
    if (target === null || isChangeOnlyControl(target)) {
      return;
    }

    const actionable = findActionableElement(target);
    if (actionable === null) {
      return;
    }

    this.submit(
      RecordingEventCandidateSchema.parse({
        schemaVersion: 1,
        eventType: 'click',
        occurredAt: this.clock.now(),
        target: createTargetSnapshot(actionable),
        payload: { activation: 'primary' },
      }),
    );
  };

  private readonly handleInput = (event: Event): void => {
    if (
      !this.capturing ||
      !this.trustedEvents.isTrusted(event) ||
      (event instanceof InputEvent && event.isComposing)
    ) {
      return;
    }

    const target = getEventElement(event);
    if (
      !(target instanceof HTMLInputElement) ||
      !SUPPORTED_TEXT_INPUT_TYPES.has(target.type) ||
      target.type === 'hidden' ||
      target.type === 'file'
    ) {
      return;
    }

    const previous = this.pendingInputs.get(target);
    if (previous !== undefined) {
      clearTimeout(previous.timer);
    }

    const candidate = createTextInputCandidate(target, this.clock.now());
    const timer = setTimeout(() => {
      this.pendingInputs.delete(target);
      this.submit(candidate);
    }, INPUT_DEBOUNCE_MS);
    this.pendingInputs.set(target, { candidate, timer });
  };

  private readonly handleChange = (event: Event): void => {
    if (!this.capturing || !this.trustedEvents.isTrusted(event)) {
      return;
    }

    const target = getEventElement(event);
    if (target instanceof HTMLSelectElement) {
      if (target.multiple) {
        return;
      }
      const value = boundedControlValue(target.value);
      const label = boundedControlValue(
        target.selectedOptions.item(0)?.textContent ?? '',
      );
      this.submit(
        RecordingEventCandidateSchema.parse({
          schemaVersion: 1,
          eventType: 'select',
          occurredAt: this.clock.now(),
          target: createTargetSnapshot(target),
          payload: {
            value: value.value,
            label: label.value,
            truncated: value.truncated || label.truncated,
          },
        }),
      );
      return;
    }

    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.type === 'checkbox') {
      this.submit(
        RecordingEventCandidateSchema.parse({
          schemaVersion: 1,
          eventType: 'checkbox',
          occurredAt: this.clock.now(),
          target: createTargetSnapshot(target),
          payload: { checked: target.checked },
        }),
      );
      return;
    }

    if (target.type === 'radio' && target.checked) {
      const value = boundedControlValue(target.value);
      this.submit(
        RecordingEventCandidateSchema.parse({
          schemaVersion: 1,
          eventType: 'radio',
          occurredAt: this.clock.now(),
          target: createTargetSnapshot(target),
          payload: {
            checked: true,
            value: value.value.length === 0 ? null : value.value,
            truncated: value.truncated,
          },
        }),
      );
    }
  };

  private readonly handleBlur = (event: Event): void => {
    if (!this.capturing || !this.trustedEvents.isTrusted(event)) {
      return;
    }

    const target = getEventElement(event);
    if (target instanceof HTMLInputElement) {
      this.flushInput(target);
    }
  };

  private flushInput(input: HTMLInputElement): void {
    const pending = this.pendingInputs.get(input);
    if (pending === undefined) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingInputs.delete(input);
    this.submit(pending.candidate);
  }

  private submit(candidate: RecordingEventCandidate): void {
    const submission = this.emitter.emit(candidate).catch(() => false);
    this.inFlight.add(submission);
    void submission.finally(() => {
      this.inFlight.delete(submission);
    });
  }

  private detach(): void {
    if (!this.capturing) {
      return;
    }

    this.capturing = false;
    this.document.removeEventListener('click', this.handleClick, true);
    this.document.removeEventListener('input', this.handleInput, true);
    this.document.removeEventListener('change', this.handleChange, true);
    this.document.removeEventListener('blur', this.handleBlur, true);
  }
}
