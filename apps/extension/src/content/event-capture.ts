import type { LocatorBundle } from '@tasktwin/locator-engine';
import {
  classifyPrivacy,
  DEFAULT_PRIVACY_SETTINGS,
  PrivacySettingsSchema,
  sanitizeCapturedValue,
  sanitizePersistedText,
  type PrivacyDecision,
  type PrivacySettings,
} from '@tasktwin/privacy-engine';

import {
  MAX_CONTROL_VALUE_LENGTH,
  MAX_INPUT_VALUE_LENGTH,
  MAX_TARGET_METADATA_LENGTH,
  MAX_TEXT_PREVIEW_LENGTH,
  RecordingEventCandidateSchema,
  RecordingTargetSnapshotSchema,
  type RecordingEventCandidate,
  type RecordingTargetSnapshot,
} from '../recorder/event-contracts.js';
import { createPrivacyClassificationInput } from './privacy-dom-adapter.js';

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

export interface LocatorBundleFactory {
  create(element: Element, generatedAt: string): LocatorBundle | null;
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

function normalizePersistedText(
  value: string,
  maximumLength: number,
): string | null {
  return sanitizePersistedText(
    normalizeText(value, maximumLength),
    maximumLength,
  );
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
  const labelText = sanitizePersistedText(
    getLabelText(element),
    MAX_TARGET_METADATA_LENGTH,
  );
  const ariaLabel = normalizePersistedText(
    element.getAttribute('aria-label') ?? '',
    MAX_TARGET_METADATA_LENGTH,
  );
  const ariaLabelledText = sanitizePersistedText(
    getAriaLabelledText(element),
    MAX_TARGET_METADATA_LENGTH,
  );
  const placeholder =
    element instanceof HTMLInputElement
      ? normalizePersistedText(element.placeholder, MAX_TARGET_METADATA_LENGTH)
      : null;
  const textPreview =
    element instanceof HTMLInputElement || element instanceof HTMLSelectElement
      ? null
      : normalizePersistedText(
          element.textContent ?? '',
          MAX_TEXT_PREVIEW_LENGTH,
        );

  return RecordingTargetSnapshotSchema.parse({
    tagName: element.tagName.toLowerCase(),
    inputType:
      element instanceof HTMLInputElement
        ? normalizeText(element.type, MAX_TARGET_METADATA_LENGTH)
        : null,
    role: normalizePersistedText(
      element.getAttribute('role') ?? '',
      MAX_TARGET_METADATA_LENGTH,
    ),
    id: normalizePersistedText(element.id, MAX_TARGET_METADATA_LENGTH),
    name: normalizePersistedText(
      element.getAttribute('name') ?? '',
      MAX_TARGET_METADATA_LENGTH,
    ),
    labelText,
    accessibleName:
      ariaLabel ?? ariaLabelledText ?? labelText ?? placeholder ?? textPreview,
    placeholder,
    textPreview,
    testIdCandidates: TEST_ID_ATTRIBUTES.flatMap((attribute) => {
      const value = normalizePersistedText(
        element.getAttribute(attribute) ?? '',
        MAX_TARGET_METADATA_LENGTH,
      );
      return value === null ? [] : [{ attribute, value }];
    }),
  });
}

function decidePrivacy(
  element: Element,
  settings: PrivacySettings,
): PrivacyDecision {
  return classifyPrivacy(createPrivacyClassificationInput(element), settings);
}

function createTextValuePayload(value: string, decision: PrivacyDecision) {
  const sanitized = sanitizeCapturedValue(
    value,
    decision,
    MAX_INPUT_VALUE_LENGTH,
  );
  switch (sanitized.policy) {
    case 'allow':
      return {
        capturePolicy: 'allow' as const,
        value: sanitized.value,
        truncated: sanitized.truncated,
      };
    case 'mask':
      return {
        capturePolicy: 'mask' as const,
        value: null,
        truncated: false as const,
      };
    case 'block':
      return { capturePolicy: 'block' as const };
  }
}

function createTextInputCandidate(
  input: HTMLInputElement,
  occurredAt: string,
  locatorBundle: LocatorBundle,
  settings: PrivacySettings,
): RecordingEventCandidate {
  const privacyDecision = decidePrivacy(input, settings);

  return RecordingEventCandidateSchema.parse({
    schemaVersion: 3,
    eventType: 'text-input',
    occurredAt,
    target: createTargetSnapshot(input),
    locatorBundle,
    privacyDecision,
    payload: createTextValuePayload(input.value, privacyDecision),
  });
}

export class EventCaptureController {
  private capturing = false;
  private privacySettings: PrivacySettings = structuredClone(
    DEFAULT_PRIVACY_SETTINGS,
  );
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
    private readonly locatorFactory: LocatorBundleFactory,
  ) {}

  configurePrivacy(settings: PrivacySettings): void {
    this.privacySettings = PrivacySettingsSchema.parse(settings);
  }

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

    const occurredAt = this.clock.now();
    const locatorBundle = this.locatorFactory.create(actionable, occurredAt);
    if (locatorBundle === null) {
      return;
    }
    const privacyDecision = decidePrivacy(actionable, this.privacySettings);
    this.submit(
      RecordingEventCandidateSchema.parse({
        schemaVersion: 3,
        eventType: 'click',
        occurredAt,
        target: createTargetSnapshot(actionable),
        locatorBundle,
        privacyDecision,
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

    const occurredAt = this.clock.now();
    const locatorBundle = this.locatorFactory.create(target, occurredAt);
    if (locatorBundle === null) {
      return;
    }
    const candidate = createTextInputCandidate(
      target,
      occurredAt,
      locatorBundle,
      this.privacySettings,
    );
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
      const occurredAt = this.clock.now();
      const locatorBundle = this.locatorFactory.create(target, occurredAt);
      if (locatorBundle === null) {
        return;
      }
      const privacyDecision = decidePrivacy(target, this.privacySettings);
      const sanitizedValue = sanitizeCapturedValue(
        value.value,
        privacyDecision,
        MAX_CONTROL_VALUE_LENGTH,
      );
      const sanitizedLabel = sanitizeCapturedValue(
        label.value,
        privacyDecision,
        MAX_CONTROL_VALUE_LENGTH,
      );
      const payload =
        sanitizedValue.policy === 'allow' && sanitizedLabel.policy === 'allow'
          ? {
              capturePolicy: 'allow' as const,
              value: sanitizedValue.value,
              label: sanitizedLabel.value,
              truncated:
                value.truncated ||
                label.truncated ||
                sanitizedValue.truncated ||
                sanitizedLabel.truncated,
            }
          : privacyDecision.policy === 'mask'
            ? {
                capturePolicy: 'mask' as const,
                value: null,
                label: null,
                truncated: false as const,
              }
            : { capturePolicy: 'block' as const };
      this.submit(
        RecordingEventCandidateSchema.parse({
          schemaVersion: 3,
          eventType: 'select',
          occurredAt,
          target: createTargetSnapshot(target),
          locatorBundle,
          privacyDecision,
          payload,
        }),
      );
      return;
    }

    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.type === 'checkbox') {
      const occurredAt = this.clock.now();
      const locatorBundle = this.locatorFactory.create(target, occurredAt);
      if (locatorBundle === null) {
        return;
      }
      const privacyDecision = decidePrivacy(target, this.privacySettings);
      const payload =
        privacyDecision.policy === 'allow'
          ? {
              capturePolicy: 'allow' as const,
              checked: target.checked,
            }
          : privacyDecision.policy === 'mask'
            ? {
                capturePolicy: 'mask' as const,
                checked: null,
              }
            : { capturePolicy: 'block' as const };
      this.submit(
        RecordingEventCandidateSchema.parse({
          schemaVersion: 3,
          eventType: 'checkbox',
          occurredAt,
          target: createTargetSnapshot(target),
          locatorBundle,
          privacyDecision,
          payload,
        }),
      );
      return;
    }

    if (target.type === 'radio' && target.checked) {
      const value = boundedControlValue(target.value);
      const occurredAt = this.clock.now();
      const locatorBundle = this.locatorFactory.create(target, occurredAt);
      if (locatorBundle === null) {
        return;
      }
      const privacyDecision = decidePrivacy(target, this.privacySettings);
      const sanitizedValue = sanitizeCapturedValue(
        value.value,
        privacyDecision,
        MAX_CONTROL_VALUE_LENGTH,
      );
      const payload =
        sanitizedValue.policy === 'allow'
          ? {
              capturePolicy: 'allow' as const,
              checked: true as const,
              value:
                sanitizedValue.value.length === 0 ? null : sanitizedValue.value,
              truncated: value.truncated || sanitizedValue.truncated,
            }
          : sanitizedValue.policy === 'mask'
            ? {
                capturePolicy: 'mask' as const,
                checked: null,
                value: null,
                truncated: false as const,
              }
            : { capturePolicy: 'block' as const };
      this.submit(
        RecordingEventCandidateSchema.parse({
          schemaVersion: 3,
          eventType: 'radio',
          occurredAt,
          target: createTargetSnapshot(target),
          locatorBundle,
          privacyDecision,
          payload,
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
