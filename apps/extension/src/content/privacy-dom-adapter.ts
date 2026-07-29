import {
  buildRedactionPlan,
  classifyPrivacy,
  MAX_PRIVACY_METADATA_LENGTH,
  PrivacyClassificationInputSchema,
  PrivacySettingsSchema,
  RedactionViewportSchema,
  type PrivacyClassificationInput,
  type PrivacySettings,
  type RedactionPlan,
  type RedactionRegionCandidate,
} from '@tasktwin/privacy-engine';

const RELEVANT_PRIVACY_SELECTOR = [
  'input:not([type="hidden"]):not([type="file"])',
  'textarea',
  'select',
  '[data-tasktwin-privacy-sensitive="true"]',
].join(',');

function normalize(value: string | null, maximum: number): string | null {
  if (value === null) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length === 0 ? null : normalized.slice(0, maximum);
}

function associatedLabelText(element: Element): string | null {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return normalize(
      element.labels?.item(0)?.textContent ?? null,
      MAX_PRIVACY_METADATA_LENGTH,
    );
  }
  return null;
}

function ariaLabelledText(element: Element): string | null {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy === null) return null;
  const text = labelledBy
    .split(/\s+/)
    .slice(0, 8)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ');
  return normalize(text, MAX_PRIVACY_METADATA_LENGTH);
}

function implicitRole(element: Element): string | null {
  const explicit = normalize(
    element.getAttribute('role'),
    MAX_PRIVACY_METADATA_LENGTH,
  );
  if (explicit !== null) return explicit;
  if (element instanceof HTMLButtonElement) return 'button';
  if (element instanceof HTMLSelectElement) return 'combobox';
  if (element instanceof HTMLTextAreaElement) return 'textbox';
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') return 'checkbox';
    if (element.type === 'radio') return 'radio';
    if (['button', 'image', 'reset', 'submit'].includes(element.type)) {
      return 'button';
    }
    return 'textbox';
  }
  return null;
}

function accessibleName(element: Element): string | null {
  return (
    normalize(
      element.getAttribute('aria-label'),
      MAX_PRIVACY_METADATA_LENGTH,
    ) ??
    ariaLabelledText(element) ??
    associatedLabelText(element) ??
    (element.hasAttribute('data-tasktwin-privacy-sensitive')
      ? normalize(element.textContent, MAX_PRIVACY_METADATA_LENGTH)
      : null)
  );
}

function inputType(element: Element): string | null {
  if (element instanceof HTMLInputElement) return element.type;
  if (element instanceof HTMLTextAreaElement) return 'textarea';
  if (element instanceof HTMLSelectElement) return 'select';
  return null;
}

export function createPrivacyClassificationInput(
  element: Element,
): PrivacyClassificationInput {
  return PrivacyClassificationInputSchema.parse({
    schemaVersion: 1,
    tagName: element.tagName.toLowerCase(),
    inputType: inputType(element),
    autocomplete: normalize(
      element.getAttribute('autocomplete'),
      MAX_PRIVACY_METADATA_LENGTH,
    ),
    name: normalize(element.getAttribute('name'), MAX_PRIVACY_METADATA_LENGTH),
    id: normalize(element.getAttribute('id'), MAX_PRIVACY_METADATA_LENGTH),
    labelText: associatedLabelText(element),
    accessibleName: accessibleName(element),
    placeholder:
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
        ? normalize(element.placeholder, MAX_PRIVACY_METADATA_LENGTH)
        : null,
    role: implicitRole(element),
  });
}

function isTextControl(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return ![
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
  ].includes(element.type);
}

function visibleRectangle(
  document: Document,
  element: Element,
): DOMRect | null {
  if (!(element instanceof HTMLElement) || element.hidden) return null;
  const style = document.defaultView?.getComputedStyle(element);
  if (
    style?.display === 'none' ||
    style?.visibility === 'hidden' ||
    style?.visibility === 'collapse' ||
    Number.parseFloat(style?.opacity ?? '1') === 0
  ) {
    return null;
  }

  const rectangle = element.getBoundingClientRect();
  if (
    !Number.isFinite(rectangle.x) ||
    !Number.isFinite(rectangle.y) ||
    !Number.isFinite(rectangle.width) ||
    !Number.isFinite(rectangle.height) ||
    rectangle.width <= 0 ||
    rectangle.height <= 0
  ) {
    return null;
  }
  return rectangle;
}

function viewportFor(document: Document) {
  const window = document.defaultView;
  return RedactionViewportSchema.parse({
    width: window?.innerWidth ?? document.documentElement.clientWidth,
    height: window?.innerHeight ?? document.documentElement.clientHeight,
    devicePixelRatio: window?.devicePixelRatio ?? 1,
  });
}

export class DomRedactionPlanFactory {
  constructor(private readonly document: Document) {}

  create(settings: PrivacySettings, generatedAt: string): RedactionPlan {
    const validatedSettings = PrivacySettingsSchema.parse(settings);
    const candidates: RedactionRegionCandidate[] = [];

    for (const [index, element] of [
      ...this.document.querySelectorAll(RELEVANT_PRIVACY_SELECTOR),
    ].entries()) {
      if (
        element instanceof HTMLInputElement &&
        (element.type === 'hidden' || element.type === 'file')
      ) {
        continue;
      }
      const rectangle = visibleRectangle(this.document, element);
      if (rectangle === null) continue;

      const decision = classifyPrivacy(
        createPrivacyClassificationInput(element),
        validatedSettings,
      );
      if (
        decision.policy === 'allow' &&
        !(validatedSettings.redactAllTextInputs && isTextControl(element))
      ) {
        continue;
      }

      candidates.push({
        id: `privacy-dom-${index + 1}`,
        x: rectangle.x,
        y: rectangle.y,
        width: rectangle.width,
        height: rectangle.height,
        sensitivity: decision.sensitivity,
        reasons: decision.matchedRules,
      });
    }

    return buildRedactionPlan({
      viewport: viewportFor(this.document),
      generatedAt,
      candidates,
    });
  }
}
