import { describe, expect, it } from 'vitest';

import {
  convertRecordingArtifact,
  RecordingConversionInputError,
} from '../src/index.js';
import {
  allowedTextEvent,
  artifact,
  blockedPasswordEvent,
  checkboxEvent,
  clickEvent,
  conversionOptions,
  maskedPersonalEvent,
  radioEvent,
  selectEvent,
} from './fixture-builders.js';

function draft(
  events: Parameters<typeof artifact>[0],
  options = conversionOptions,
) {
  const result = convertRecordingArtifact(artifact(events), options);
  if (result.outcome !== 'draft') {
    throw new Error('Expected a workflow draft conversion.');
  }
  return result;
}

describe('convertRecordingArtifact', () => {
  it('maps click, allowed text, select, checkbox, and radio events in order', () => {
    const result = draft([
      clickEvent(1),
      allowedTextEvent(2),
      selectEvent(3),
      checkboxEvent(4, true),
      checkboxEvent(5, false),
      radioEvent(6),
    ]);

    expect(result.workflowDefinition.steps.map((step) => step.type)).toEqual([
      'click',
      'fill',
      'select',
      'setChecked',
      'setChecked',
      'setChecked',
    ]);
    expect(result.workflowDefinition.steps.map((step) => step.id)).toEqual([
      'step-001',
      'step-002',
      'step-003',
      'step-004',
      'step-005',
      'step-006',
    ]);
    expect(result.report.mappings.map((mapping) => mapping.sequence)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);

    const checkedStates = result.workflowDefinition.steps
      .filter((step) => step.type === 'setChecked')
      .map((step) => step.checked);
    expect(checkedStates).toEqual([true, false, true]);
  });

  it('uses literal value sources only for allowed, complete values', () => {
    const result = draft([allowedTextEvent(1, 'bounded safe value')]);
    const step = result.workflowDefinition.steps[0];

    expect(step).toMatchObject({
      type: 'fill',
      value: { kind: 'literal', value: 'bounded safe value' },
    });
  });

  it('creates deterministic required variables for masked personal values', () => {
    const first = maskedPersonalEvent(1, 'customerEmail');
    const second = maskedPersonalEvent(3, 'customerEmail');
    const events = [first, clickEvent(2), second];
    const firstResult = draft(events);
    const secondResult = draft(events);

    expect(firstResult).toEqual(secondResult);
    expect(firstResult.workflowDefinition.variables).toEqual([
      {
        name: 'customerEmail',
        valueType: 'string',
        required: true,
        description: 'Value for Customer email.',
      },
      {
        name: 'customerEmail2',
        valueType: 'string',
        required: true,
        description: 'Value for Customer email.',
      },
    ]);
    expect(
      firstResult.workflowDefinition.steps
        .filter((step) => step.type === 'fill')
        .map((step) => step.value),
    ).toEqual([
      { kind: 'variable', variableName: 'customerEmail' },
      { kind: 'variable', variableName: 'customerEmail2' },
    ]);
  });

  it('converts a blocked password into only a secret reference', () => {
    const result = draft([blockedPasswordEvent(1)]);
    const serialized = JSON.stringify(result);

    expect(result.workflowDefinition.variables).toEqual([]);
    expect(result.workflowDefinition.steps[0]).toMatchObject({
      type: 'fill',
      value: { kind: 'secret', secretName: 'password' },
    });
    expect(serialized).not.toContain('"capturePolicy":"block"');
    expect(serialized).not.toContain('"value":"plaintext-password"');
  });

  it('uses safe deterministic action names', () => {
    const result = draft([
      clickEvent(1),
      selectEvent(2),
      checkboxEvent(3, true),
      checkboxEvent(4, false),
    ]);

    expect(result.workflowDefinition.steps.map((step) => step.name)).toEqual([
      'Click Add customer',
      'Select Premium in Service package',
      'Enable Send welcome email',
      'Disable Send welcome email',
    ]);
  });

  it('warns for a low-confidence locator without blocking the draft', () => {
    const result = draft([clickEvent(1, 'low')]);

    expect(result.report.issues).toEqual([
      expect.objectContaining({
        code: 'LOW_LOCATOR_CONFIDENCE',
        severity: 'warning',
      }),
    ]);
    expect(result.report.publishable).toBe(true);
  });

  it('deduplicates exact consecutive state-setting events and reports them', () => {
    const first = allowedTextEvent(1, 'same');
    const duplicate = {
      ...allowedTextEvent(2, 'same'),
      locatorBundle: first.locatorBundle,
      target: first.target,
    };
    const result = draft([first, duplicate]);

    expect(result.workflowDefinition.steps).toHaveLength(1);
    expect(result.report.deduplicatedEventCount).toBe(1);
    expect(result.report.mappings[1]).toMatchObject({
      outcome: 'deduplicated',
      retainedStepId: 'step-001',
    });
    expect(result.report.issues).toContainEqual(
      expect.objectContaining({
        code: 'DUPLICATE_EVENT_REMOVED',
        severity: 'info',
      }),
    );
  });

  it('does not deduplicate equivalent events separated by another action', () => {
    const first = allowedTextEvent(1, 'same');
    const separated = {
      ...allowedTextEvent(3, 'same'),
      locatorBundle: first.locatorBundle,
      target: first.target,
    };
    const result = draft([first, clickEvent(2), separated]);

    expect(result.workflowDefinition.steps).toHaveLength(3);
    expect(result.report.deduplicatedEventCount).toBe(0);
  });

  it('does not deduplicate consecutive clicks', () => {
    const first = clickEvent(1);
    const second = {
      ...clickEvent(2),
      locatorBundle: first.locatorBundle,
      target: first.target,
    };
    const result = draft([first, second]);

    expect(result.workflowDefinition.steps).toHaveLength(2);
    expect(result.report.deduplicatedEventCount).toBe(0);
  });

  it('returns a non-publishable result when an unsafe event is unresolved', () => {
    const unsafe = {
      ...blockedPasswordEvent(2),
      target: {
        ...blockedPasswordEvent(2).target,
        tagName: 'select',
        inputType: null,
        role: 'combobox',
      },
    };
    const result = draft([clickEvent(1), unsafe]);

    expect(result.report.publishable).toBe(false);
    expect(result.report.unresolvedEventCount).toBe(1);
    expect(result.report.unresolvedEvents[0]).toMatchObject({
      sequence: 2,
      issueCodes: ['BLOCKED_VALUE_UNRESOLVED'],
    });
    expect(result.report.mappings[1]).toMatchObject({
      outcome: 'unresolved',
    });
  });

  it('returns a validated no-step result for an empty recording', () => {
    const result = convertRecordingArtifact(artifact([]), conversionOptions);

    expect(result).toMatchObject({
      outcome: 'no-executable-steps',
      workflowDefinition: null,
      report: {
        generatedStepCount: 0,
        publishable: false,
      },
    });
    expect(result.report.issues).toContainEqual(
      expect.objectContaining({
        code: 'NO_EXECUTABLE_STEPS',
        severity: 'blocking',
      }),
    );
  });

  it('rejects an invalid unchecked radio before conversion', () => {
    const selected = radioEvent(1);
    const unchecked = {
      ...selected,
      payload: { ...selected.payload, checked: false },
    };
    const invalidArtifact = {
      ...artifact([selected]),
      events: [unchecked],
    };

    try {
      convertRecordingArtifact(invalidArtifact, conversionOptions);
      throw new Error('Expected invalid unchecked radio to be rejected.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(RecordingConversionInputError);
      expect((error as RecordingConversionInputError).issues).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_EVENT_PAYLOAD',
          severity: 'blocking',
        }),
      );
    }
  });

  it('reports a blocking issue for a source event with a missing locator', () => {
    const event = clickEvent(1);
    const { locatorBundle: _locatorBundle, ...withoutLocator } = event;
    const invalidArtifact = {
      ...artifact([event]),
      events: [withoutLocator],
    };

    try {
      convertRecordingArtifact(invalidArtifact, conversionOptions);
      throw new Error('Expected missing locator to be rejected.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(RecordingConversionInputError);
      expect((error as RecordingConversionInputError).issues).toContainEqual(
        expect.objectContaining({
          code: 'NO_USABLE_LOCATOR',
          severity: 'blocking',
          eventId: event.eventId,
          sequence: 1,
        }),
      );
    }
  });

  it('reports an unsupported event type instead of silently dropping it', () => {
    const event = clickEvent(1);
    const invalidArtifact = {
      ...artifact([event]),
      events: [{ ...event, eventType: 'scroll' }],
    };

    try {
      convertRecordingArtifact(invalidArtifact, conversionOptions);
      throw new Error('Expected an unsupported event type to be rejected.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(RecordingConversionInputError);
      expect((error as RecordingConversionInputError).issues).toContainEqual(
        expect.objectContaining({
          code: 'UNSUPPORTED_EVENT_TYPE',
          severity: 'blocking',
          eventId: event.eventId,
          sequence: 1,
        }),
      );
    }
  });

  it('rejects unexpected conversion option properties', () => {
    expect(() =>
      convertRecordingArtifact(artifact([clickEvent(1)]), {
        ...conversionOptions,
        accessToken: 'must-not-be-accepted',
      }),
    ).toThrow();
  });
});
