import { randomUUID } from 'node:crypto';

import { canonicalizeLocator } from '@tasktwin/locator-engine';
import { classifyPrivacy } from '@tasktwin/privacy-engine';
import {
  isLocatorCompatibleWithStep,
  rankLocatorRepairCandidates,
  type LocatorRepairCandidateInput,
  type LocatorRepairDiscoverySeed,
  type LocatorRepairElementKind,
  type RunnerLocatorRepairProposalCreate,
} from '@tasktwin/workflow-locator-repair';
import type { ElementLocator } from '@tasktwin/workflow-schema';
import type { Locator, Page } from 'playwright';

import { PlaywrightLocatorAdapter } from '../execution/locator-adapter.js';

const RELEVANT_ELEMENTS =
  'button,a,input:not([type="hidden"]):not([type="password"]):not([type="file"]),select,textarea,[role]';
const MAX_RELEVANT_ELEMENTS = 100;
const TEST_ID_ATTRIBUTES = [
  'data-testid',
  'data-test',
  'data-cy',
  'data-qa',
] as const;

function bounded(value: string | null, maximum = 160): string | null {
  if (value === null) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized === '' ? null : normalized.slice(0, maximum);
}

function escapeCss(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function normalize(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function roleFor(
  tagName: string,
  inputType: string | null,
  explicitRole: string | null,
): string | null {
  if (explicitRole !== null) return explicitRole;
  if (tagName === 'button') return 'button';
  if (tagName === 'a') return 'link';
  if (tagName === 'select') return 'combobox';
  if (tagName === 'textarea') return 'textbox';
  if (tagName === 'input') {
    if (inputType === 'checkbox') return 'checkbox';
    if (inputType === 'radio') return 'radio';
    return 'textbox';
  }
  return null;
}

function elementKind(
  tagName: string,
  inputType: string | null,
  role: string | null,
): LocatorRepairElementKind {
  if (role === 'button' || tagName === 'button') return 'button';
  if (role === 'link' || tagName === 'a') return 'link';
  if (role === 'checkbox' || inputType === 'checkbox') return 'checkbox';
  if (role === 'radio' || inputType === 'radio') return 'radio';
  if (role === 'combobox' || tagName === 'select') return 'select';
  if (role === 'textbox' || tagName === 'input' || tagName === 'textarea') {
    return 'text_input';
  }
  return 'generic';
}

interface InspectedElement {
  locator: Locator;
  tagName: string;
  inputType: string | null;
  autocomplete: string | null;
  name: string | null;
  id: string | null;
  labelText: string | null;
  accessibleName: string | null;
  placeholder: string | null;
  role: string | null;
  className: string | null;
  testIds: Array<{
    attribute: (typeof TEST_ID_ATTRIBUTES)[number];
    value: string;
  }>;
  kind: LocatorRepairElementKind;
}

async function inspectElement(
  page: Page,
  locator: Locator,
): Promise<InspectedElement> {
  const tagName = (
    await locator.evaluate((element) => element.tagName.toLowerCase())
  ).slice(0, 32);
  const inputType = bounded(await locator.getAttribute('type'));
  const explicitRole = bounded(await locator.getAttribute('role'));
  const id = bounded(await locator.getAttribute('id'));
  let labelText: string | null = null;
  if (id !== null) {
    const label = page.locator(`label[for="${escapeCss(id)}"]`).first();
    if ((await label.count()) === 1)
      labelText = bounded(await label.innerText());
  }
  const ariaLabel = bounded(await locator.getAttribute('aria-label'));
  const innerText =
    tagName === 'input' || tagName === 'select' || tagName === 'textarea'
      ? null
      : bounded(await locator.innerText().catch(() => null), 80);
  const accessibleName = ariaLabel ?? labelText ?? innerText;
  const role = roleFor(tagName, inputType, explicitRole);
  const testIds: InspectedElement['testIds'] = [];
  for (const attribute of TEST_ID_ATTRIBUTES) {
    const value = bounded(await locator.getAttribute(attribute), 80);
    if (value !== null) testIds.push({ attribute, value });
  }
  return {
    locator,
    tagName,
    inputType,
    autocomplete: bounded(await locator.getAttribute('autocomplete')),
    name: bounded(await locator.getAttribute('name')),
    id,
    labelText,
    accessibleName,
    placeholder: bounded(await locator.getAttribute('placeholder')),
    role,
    className: bounded(await locator.getAttribute('class'), 120),
    testIds,
    kind: elementKind(tagName, inputType, role),
  };
}

async function observation(
  adapter: PlaywrightLocatorAdapter,
  locator: ElementLocator,
  source: LocatorRepairCandidateInput['observation']['source'],
  stabilityValue: string,
) {
  return {
    locator,
    source,
    matchCount: await adapter.create(locator).count(),
    stabilityValue,
  } as const;
}

async function inputsForElement(
  page: Page,
  adapter: PlaywrightLocatorAdapter,
  element: InspectedElement,
  seed: LocatorRepairDiscoverySeed,
  baseEvidence: LocatorRepairCandidateInput['evidenceCodes'],
): Promise<LocatorRepairCandidateInput[]> {
  if (!isLocatorCompatibleWithStep(seed.step, element.kind)) return [];
  const privacyInput = {
    schemaVersion: 1 as const,
    tagName: element.tagName,
    inputType: element.inputType,
    autocomplete: element.autocomplete,
    name: element.name,
    id: element.id,
    labelText: element.labelText,
    accessibleName: element.accessibleName,
    placeholder: element.placeholder,
    role: element.role,
  };
  const privacyDecision = classifyPrivacy(privacyInput);
  if (privacyDecision.policy !== 'allow') return [];
  const specs: Array<{
    locator: ElementLocator;
    source: LocatorRepairCandidateInput['observation']['source'];
    value: string;
    evidence: LocatorRepairCandidateInput['evidenceCodes'][number];
  }> = [];
  for (const testId of element.testIds) {
    specs.push({
      locator: {
        kind: 'testId',
        value: testId.value,
        ...(testId.attribute === 'data-testid'
          ? {}
          : { attribute: testId.attribute }),
      },
      source: 'testId',
      value: testId.value,
      evidence: 'TARGET_TEST_ID_MATCH',
    });
  }
  if (element.role !== null && element.accessibleName !== null) {
    specs.push({
      locator: {
        kind: 'role',
        role: element.role,
        name: element.accessibleName,
        exact: true,
      },
      source: 'role',
      value: element.accessibleName,
      evidence: 'TARGET_ROLE_MATCH',
    });
  }
  if (element.labelText !== null) {
    specs.push({
      locator: { kind: 'label', value: element.labelText, exact: true },
      source: 'label',
      value: element.labelText,
      evidence: 'TARGET_LABEL_MATCH',
    });
  }
  if (element.placeholder !== null) {
    specs.push({
      locator: {
        kind: 'placeholder',
        value: element.placeholder,
        exact: true,
      },
      source: 'placeholder',
      value: element.placeholder,
      evidence: 'TARGET_PLACEHOLDER_MATCH',
    });
  }
  if (element.id !== null) {
    specs.push({
      locator: { kind: 'css', selector: `[id="${escapeCss(element.id)}"]` },
      source: 'stableId',
      value: element.id,
      evidence: 'TARGET_STABLE_ID_MATCH',
    });
  }
  if (
    element.accessibleName !== null &&
    (element.kind === 'button' ||
      element.kind === 'link' ||
      element.kind === 'generic')
  ) {
    specs.push({
      locator: {
        kind: 'text',
        value: element.accessibleName,
        exact: true,
      },
      source: 'text',
      value: element.accessibleName,
      evidence: 'TARGET_SAFE_TEXT_MATCH',
    });
  }
  const safeClass = element.className
    ?.split(/\s+/)
    .find((value) => /^[A-Za-z_-][A-Za-z0-9_-]{0,63}$/.test(value));
  const css =
    safeClass === undefined
      ? element.name === null
        ? element.tagName
        : `${element.tagName}[name="${escapeCss(element.name)}"]`
      : `${element.tagName}.${safeClass}`;
  specs.push({
    locator: { kind: 'css', selector: css },
    source: 'css',
    value: css,
    evidence: 'TARGET_SAFE_TEXT_MATCH',
  });
  return Promise.all(
    specs.map(async (spec) => ({
      observation: await observation(
        adapter,
        spec.locator,
        spec.source,
        spec.value,
      ),
      privacyInput,
      privacyDecision,
      elementKind: element.kind,
      evidenceCodes: [
        ...baseEvidence,
        spec.evidence,
        'STEP_CONTROL_COMPATIBLE' as const,
        'PRIVACY_ALLOWED' as const,
      ],
    })),
  );
}

export async function discoverLocatorRepairProposal(input: {
  page: Page;
  seed: LocatorRepairDiscoverySeed;
  pageContextDigest: string;
  generatedAt: string;
}): Promise<RunnerLocatorRepairProposalCreate> {
  const adapter = new PlaywrightLocatorAdapter(input.page, 1_000);
  const selected: Array<{
    locator: Locator;
    evidence: LocatorRepairCandidateInput['evidenceCodes'];
  }> = [];
  for (const fallback of input.seed.recordedFallbacks) {
    const locator = adapter.create(fallback);
    if ((await locator.count()) === 1) {
      selected.push({ locator, evidence: ['RECORDED_FALLBACK_MATCH'] });
    }
  }
  const source = adapter.create(input.seed.sourceLocator);
  const sourceCount = await source.count();
  if (sourceCount > 0 && sourceCount <= 20) {
    for (let index = 0; index < sourceCount; index += 1) {
      selected.push({
        locator: source.nth(index),
        evidence: ['RECORDED_PRIMARY_MATCH'],
      });
    }
  }
  const relevant = input.page.locator(RELEVANT_ELEMENTS);
  const relevantCount = Math.min(await relevant.count(), MAX_RELEVANT_ELEMENTS);
  for (let index = 0; index < relevantCount; index += 1) {
    const inspected = await inspectElement(input.page, relevant.nth(index));
    if (
      normalize(inspected.accessibleName) === normalize(input.seed.step.name) ||
      normalize(inspected.labelText) === normalize(input.seed.step.name) ||
      normalize(inspected.placeholder) === normalize(input.seed.step.name)
    ) {
      selected.push({
        locator: inspected.locator,
        evidence: ['TARGET_SAFE_TEXT_MATCH'],
      });
    }
  }
  const allInputs: LocatorRepairCandidateInput[] = [];
  for (const item of selected.slice(0, 20)) {
    const inspected = await inspectElement(input.page, item.locator);
    allInputs.push(
      ...(await inputsForElement(
        input.page,
        adapter,
        inspected,
        input.seed,
        item.evidence,
      )),
    );
  }
  const deduplicated = new Map<string, LocatorRepairCandidateInput>();
  for (const candidate of allInputs) {
    const key = canonicalizeLocator(candidate.observation.locator);
    if (!deduplicated.has(key)) deduplicated.set(key, candidate);
  }
  const ranked = rankLocatorRepairCandidates(
    [...deduplicated.values()],
    input.generatedAt,
  );
  return {
    schemaVersion: 1,
    clientProposalId: randomUUID(),
    repairRequestId: input.seed.repairRequestId,
    pageContextDigest: input.pageContextDigest,
    generatedAt: input.generatedAt,
    candidates: ranked.map((item) => ({
      clientCandidateId: randomUUID(),
      locator: item.candidate.locator,
      source: item.candidate.source,
      score: item.candidate.score,
      confidence: item.confidence,
      elementKind: item.elementKind,
      reasonCodes: item.candidate.reasons.map((reason) => reason.code),
      evidenceCodes: item.evidenceCodes,
      privacyInput: deduplicated.get(
        canonicalizeLocator(item.candidate.locator),
      )!.privacyInput,
      privacyDecision: item.privacyDecision,
    })),
  };
}
