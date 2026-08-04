import { classifyPrivacy } from '@tasktwin/privacy-engine';
import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { describe, expect, it } from 'vitest';

import {
  assessLocatorRepairEligibility,
  rankLocatorRepairCandidates,
  replaceWorkflowStepLocator,
  type LocatorRepairCandidateInput,
} from '../src/index.js';

const privacyInput = {
  schemaVersion: 1 as const,
  tagName: 'button',
  inputType: null,
  autocomplete: null,
  name: null,
  id: null,
  labelText: null,
  accessibleName: 'Submit fixture',
  placeholder: null,
  role: 'button',
};

function workflow(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: 'locatorRepairFixture',
    version: 1,
    name: 'Locator repair fixture',
    status: 'draft',
    variables: [],
    steps: [
      {
        id: 'submit',
        type: 'click',
        name: 'Submit',
        locator: { kind: 'testId', value: 'old-submit' },
      },
      {
        id: 'verify',
        type: 'verify',
        name: 'Verify message',
        assertion: {
          kind: 'text',
          locator: { kind: 'testId', value: 'message' },
          matchMode: 'exact',
          expected: { kind: 'literal', value: 'Completed' },
        },
      },
    ],
  };
}

function candidate(
  source: LocatorRepairCandidateInput['observation']['source'],
  locator: LocatorRepairCandidateInput['observation']['locator'],
  stabilityValue: string,
  overrides: Partial<LocatorRepairCandidateInput> = {},
): LocatorRepairCandidateInput {
  const decision = classifyPrivacy(privacyInput);
  return {
    observation: { locator, source, matchCount: 1, stabilityValue },
    privacyInput,
    privacyDecision: decision,
    elementKind: 'button',
    evidenceCodes: ['STEP_CONTROL_COMPATIBLE', 'PRIVACY_ALLOWED'],
    ...overrides,
  };
}

describe('locator repair eligibility', () => {
  it('accepts not-found and not-unique failures with safe effects', () => {
    const step = workflow().steps[0]!;
    expect(
      assessLocatorRepairEligibility({
        step,
        errorCode: 'LOCATOR_NOT_FOUND',
        effectCertainty: 'not_started',
        approvalGated: false,
      }).eligible,
    ).toBe(true);
    expect(
      assessLocatorRepairEligibility({
        step: workflow().steps[1]!,
        errorCode: 'LOCATOR_NOT_UNIQUE',
        effectCertainty: 'read_only',
        approvalGated: false,
      }).eligible,
    ).toBe(true);
  });

  it.each(['side_effect_possible', 'unknown'] as const)(
    'rejects %s effects',
    (effectCertainty) => {
      expect(
        assessLocatorRepairEligibility({
          step: workflow().steps[0]!,
          errorCode: 'LOCATOR_NOT_FOUND',
          effectCertainty,
          approvalGated: false,
        }),
      ).toEqual({ eligible: false, reason: 'EFFECT_NOT_SAFE' });
    },
  );
});

describe('candidate ranking and privacy', () => {
  it('is deterministic and ranks stable semantic locators above CSS', () => {
    const inputs = [
      candidate(
        'css',
        { kind: 'css', selector: 'main > button.action' },
        'main > button.action',
      ),
      candidate(
        'role',
        { kind: 'role', role: 'button', name: 'Submit fixture', exact: true },
        'Submit fixture',
      ),
      candidate(
        'testId',
        { kind: 'testId', value: 'submit-fixture' },
        'submit-fixture',
      ),
    ];
    const first = rankLocatorRepairCandidates(
      inputs,
      '2026-08-04T00:00:00.000Z',
    );
    const second = rankLocatorRepairCandidates(
      [...inputs].reverse(),
      '2026-08-04T00:00:00.000Z',
    );
    expect(first).toEqual(second);
    expect(first.map((item) => item.candidate.source)).toEqual([
      'testId',
      'role',
      'css',
    ]);
  });

  it('penalizes dynamic identifiers and caps the result at five', () => {
    const inputs = Array.from({ length: 8 }, (_, index) =>
      candidate(
        'testId',
        {
          kind: 'testId',
          value:
            index === 0
              ? '550e8400-e29b-41d4-a716-446655440000'
              : `stable-action-${String.fromCharCode(97 + index)}`,
        },
        index === 0
          ? '550e8400-e29b-41d4-a716-446655440000'
          : `stable-action-${String.fromCharCode(97 + index)}`,
      ),
    );
    const ranked = rankLocatorRepairCandidates(
      inputs,
      '2026-08-04T00:00:00.000Z',
    );
    expect(ranked).toHaveLength(5);
    expect(ranked[0]?.candidate.locator).not.toEqual(
      inputs[0]?.observation.locator,
    );
  });

  it('removes privacy-blocked candidates', () => {
    const blockedInput = {
      ...privacyInput,
      tagName: 'input',
      inputType: 'password',
      accessibleName: 'Password',
      role: 'textbox',
    };
    const ranked = rankLocatorRepairCandidates(
      [
        candidate(
          'label',
          { kind: 'label', value: 'Password', exact: true },
          'Password',
          {
            privacyInput: blockedInput,
            privacyDecision: classifyPrivacy(blockedInput),
            elementKind: 'text_input',
          },
        ),
      ],
      '2026-08-04T00:00:00.000Z',
    );
    expect(ranked).toEqual([]);
  });
});

describe('immutable locator patch', () => {
  it('changes only the target locator and leaves the source untouched', () => {
    const source = workflow();
    const snapshot = structuredClone(source);
    const result = replaceWorkflowStepLocator(source, 'submit', {
      kind: 'role',
      role: 'button',
      name: 'Submit fixture',
      exact: true,
    });
    expect(result.ok).toBe(true);
    expect(source).toEqual(snapshot);
    if (!result.ok) return;
    expect(result.workflow.steps[1]).toEqual(source.steps[1]);
    expect(result.workflow.steps[0]).toEqual({
      ...source.steps[0],
      locator: {
        kind: 'role',
        role: 'button',
        name: 'Submit fixture',
        exact: true,
      },
    });
  });
});
