import {
  detectIdentifierRisks,
  looksLikeGeneratedClass,
  MAX_CSS_SELECTOR_LENGTH,
  MAX_LOCATOR_VALUE_LENGTH,
  MAX_TEST_ID_LENGTH,
  MAX_VISIBLE_TEXT_LENGTH,
  rankLocatorBundle,
  type LocatorBundle,
  type LocatorObservation,
} from '@tasktwin/locator-engine';
import { containsSensitiveLiteral } from '@tasktwin/privacy-engine';

const TEST_ID_ATTRIBUTES = [
  'data-testid',
  'data-test',
  'data-cy',
  'data-qa',
] as const;

const TEXT_ROLES = new Set(['button', 'link']);
const EXPLICIT_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'listbox',
  'menuitem',
  'option',
  'radio',
  'switch',
  'tab',
]);

function normalize(value: string, maximum: number): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length === 0 ? null : normalized.slice(0, maximum);
}

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function countRelevantElements(
  document: Document,
  selector: string,
  predicate: (element: Element) => boolean,
): number {
  let count = 0;
  for (const element of document.querySelectorAll(selector)) {
    if (predicate(element)) {
      count += 1;
    }
  }
  return count;
}

function labelText(element: Element): string | null {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const label = element.labels?.item(0);
    if (label !== null && label !== undefined) {
      return normalize(label.textContent ?? '', MAX_LOCATOR_VALUE_LENGTH);
    }
  }
  return null;
}

function ariaLabelledText(element: Element): string | null {
  const ids = element.getAttribute('aria-labelledby');
  if (ids === null) {
    return null;
  }
  return normalize(
    ids
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' '),
    MAX_LOCATOR_VALUE_LENGTH,
  );
}

function implicitRole(element: Element): string | null {
  const explicit = normalize(
    element.getAttribute('role') ?? '',
    MAX_LOCATOR_VALUE_LENGTH,
  );
  if (explicit !== null && EXPLICIT_ROLES.has(explicit)) {
    return explicit;
  }
  if (element instanceof HTMLButtonElement) return 'button';
  if (element instanceof HTMLAnchorElement && element.hasAttribute('href')) {
    return 'link';
  }
  if (element instanceof HTMLSelectElement) return 'combobox';
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') return 'checkbox';
    if (element.type === 'radio') return 'radio';
    if (['button', 'image', 'reset', 'submit'].includes(element.type)) {
      return 'button';
    }
  }
  return null;
}

function accessibleName(element: Element): string | null {
  const aria = normalize(
    element.getAttribute('aria-label') ?? '',
    MAX_LOCATOR_VALUE_LENGTH,
  );
  if (aria !== null) return aria;
  const labelled = ariaLabelledText(element);
  if (labelled !== null) return labelled;
  const label = labelText(element);
  if (label !== null) return label;
  if (element instanceof HTMLInputElement) {
    return normalize(
      element.getAttribute('alt') ?? '',
      MAX_LOCATOR_VALUE_LENGTH,
    );
  }
  return normalize(element.textContent ?? '', MAX_LOCATOR_VALUE_LENGTH);
}

function isStable(value: string): boolean {
  return detectIdentifierRisks(value).length === 0;
}

function queryCount(document: Document, selector: string): number {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

function stableClass(element: Element): string | null {
  for (const token of element.classList) {
    if (
      token.length <= 64 &&
      /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(token) &&
      isStable(token) &&
      !containsSensitiveLiteral(token) &&
      !looksLikeGeneratedClass(`.${token}`)
    ) {
      return token;
    }
  }
  return null;
}

function cssSegment(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const className = stableClass(element);
  if (className !== null) return `${tag}.${className}`;
  const role = normalize(element.getAttribute('role') ?? '', 40);
  if (role !== null) return `${tag}[role="${cssString(role)}"]`;
  if (element instanceof HTMLInputElement && element.type.length > 0) {
    return `${tag}[type="${cssString(element.type)}"]`;
  }
  return tag;
}

function boundedCssSelector(element: Element): string | null {
  const document = element.ownerDocument;
  const direct = cssSegment(element);
  if (queryCount(document, direct) === 1) return direct;

  const segments = [direct];
  let current = element.parentElement;
  while (current !== null && segments.length < 4) {
    segments.unshift(cssSegment(current));
    const selector = segments.join(' > ');
    if (
      selector.length <= MAX_CSS_SELECTOR_LENGTH &&
      queryCount(document, selector) === 1
    ) {
      return selector;
    }
    current = current.parentElement;
  }

  const parent = element.parentElement;
  if (parent === null) return null;
  const sameTag = [...parent.children].filter(
    (sibling) => sibling.tagName === element.tagName,
  );
  const position = sameTag.indexOf(element) + 1;
  if (position < 1) return null;
  const positional = `${cssSegment(parent)} > ${element.tagName.toLowerCase()}:nth-of-type(${position})`;
  return positional.length <= MAX_CSS_SELECTOR_LENGTH &&
    queryCount(document, positional) === 1
    ? positional
    : null;
}

function observation(
  locator: LocatorObservation['locator'],
  source: LocatorObservation['source'],
  matchCount: number,
  stabilityValue: string,
): LocatorObservation {
  return { locator, source, matchCount, stabilityValue };
}

export class DomLocatorBundleFactory {
  constructor(private readonly document: Document) {}

  create(element: Element, generatedAt: string): LocatorBundle | null {
    if (element.ownerDocument !== this.document) return null;
    const observations: LocatorObservation[] = [];

    for (const attribute of TEST_ID_ATTRIBUTES) {
      const value = normalize(
        element.getAttribute(attribute) ?? '',
        MAX_TEST_ID_LENGTH,
      );
      if (value === null || containsSensitiveLiteral(value)) continue;
      observations.push(
        observation(
          { kind: 'testId', attribute, value },
          'testId',
          countRelevantElements(
            this.document,
            `[${attribute}]`,
            (candidate) => candidate.getAttribute(attribute) === value,
          ),
          value,
        ),
      );
    }

    const role = implicitRole(element);
    const name = accessibleName(element);
    if (role !== null && name !== null && !containsSensitiveLiteral(name)) {
      observations.push(
        observation(
          { kind: 'role', role, name, exact: true },
          'role',
          countRelevantElements(
            this.document,
            'button, a[href], input, select, textarea, [role]',
            (candidate) =>
              implicitRole(candidate) === role &&
              accessibleName(candidate) === name,
          ),
          `${role}:${name}`.slice(0, MAX_LOCATOR_VALUE_LENGTH),
        ),
      );
    }

    const label = labelText(element);
    if (label !== null && !containsSensitiveLiteral(label)) {
      observations.push(
        observation(
          { kind: 'label', value: label, exact: true },
          'label',
          countRelevantElements(
            this.document,
            'input, select, textarea',
            (candidate) => labelText(candidate) === label,
          ),
          label,
        ),
      );
    }

    const id = normalize(element.id, MAX_LOCATOR_VALUE_LENGTH);
    if (id !== null && !containsSensitiveLiteral(id)) {
      const selector = `[id="${cssString(id)}"]`;
      observations.push(
        observation(
          { kind: 'css', selector },
          'stableId',
          queryCount(this.document, selector),
          id,
        ),
      );
    }

    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    ) {
      const placeholder = normalize(
        element.placeholder,
        MAX_LOCATOR_VALUE_LENGTH,
      );
      if (placeholder !== null && !containsSensitiveLiteral(placeholder)) {
        observations.push(
          observation(
            { kind: 'placeholder', value: placeholder, exact: true },
            'placeholder',
            countRelevantElements(
              this.document,
              'input, textarea',
              (candidate) =>
                (candidate instanceof HTMLInputElement ||
                  candidate instanceof HTMLTextAreaElement) &&
                normalize(candidate.placeholder, MAX_LOCATOR_VALUE_LENGTH) ===
                  placeholder,
            ),
            placeholder,
          ),
        );
      }
    }

    const nameAttribute = normalize(
      element.getAttribute('name') ?? '',
      MAX_LOCATOR_VALUE_LENGTH,
    );
    if (nameAttribute !== null && !containsSensitiveLiteral(nameAttribute)) {
      const selector = `[name="${cssString(nameAttribute)}"]`;
      observations.push(
        observation(
          { kind: 'css', selector },
          'stableName',
          queryCount(this.document, selector),
          nameAttribute,
        ),
      );
    }

    const visibleText =
      role !== null && TEXT_ROLES.has(role)
        ? normalize(element.textContent ?? '', MAX_VISIBLE_TEXT_LENGTH)
        : null;
    if (visibleText !== null && !containsSensitiveLiteral(visibleText)) {
      observations.push(
        observation(
          { kind: 'text', value: visibleText, exact: true },
          'text',
          countRelevantElements(
            this.document,
            'button, a[href], [role="button"], [role="link"]',
            (candidate) =>
              TEXT_ROLES.has(implicitRole(candidate) ?? '') &&
              normalize(
                candidate.textContent ?? '',
                MAX_VISIBLE_TEXT_LENGTH,
              ) === visibleText,
          ),
          visibleText,
        ),
      );
    }

    const css = boundedCssSelector(element);
    if (css !== null) {
      observations.push(
        observation(
          { kind: 'css', selector: css },
          'css',
          queryCount(this.document, css),
          css.slice(0, MAX_LOCATOR_VALUE_LENGTH),
        ),
      );
    }

    const ranked = rankLocatorBundle(observations, generatedAt);
    return ranked.success ? ranked.bundle : null;
  }
}
