'use client';

import { summarizeNavigateUrl } from '@tasktwin/workflow-editor-core';
import type { ValueSourceTarget } from '@tasktwin/workflow-inputs';
import type {
  ElementLocator,
  ValueSource,
  VerifyStep,
  WorkflowAssertion,
  WorkflowStep,
  WorkflowVariable,
} from '@tasktwin/workflow-schema';

import type { WorkflowVersionDetailResponse } from '@/lib/control-plane-contracts';

import { ValueSourceField } from './value-source-field';

interface StepInspectorProps {
  step: WorkflowStep;
  variables: WorkflowVariable[];
  readOnly: boolean;
  locatorMetadata: WorkflowVersionDetailResponse['locatorMetadata'];
  onChange(step: WorkflowStep): void;
  onValueSourceChange(target: ValueSourceTarget, source: ValueSource): void;
}

function locatorForStep(step: WorkflowStep): ElementLocator | null {
  switch (step.type) {
    case 'click':
    case 'fill':
    case 'select':
    case 'setChecked':
    case 'extract':
      return step.locator;
    case 'verify':
      return 'locator' in step.assertion ? step.assertion.locator : null;
    default:
      return null;
  }
}

function VerifyFields({
  step,
  variables,
  readOnly,
  onChange,
  onValueSourceChange,
}: {
  step: VerifyStep;
  variables: WorkflowVariable[];
  readOnly: boolean;
  onChange(step: VerifyStep): void;
  onValueSourceChange(target: ValueSourceTarget, source: ValueSource): void;
}) {
  const assertion = step.assertion;
  return (
    <div className="reference-summary">
      <p>Assertion: {assertion.kind}</p>
      {'locator' in assertion ? (
        <label>
          Verification kind
          <select
            value={assertion.kind}
            disabled={readOnly}
            onChange={(event) => {
              const kind = event.currentTarget.value as
                'visible' | 'hidden' | 'text' | 'value' | 'checked';
              const locator = assertion.locator;
              let nextAssertion: WorkflowAssertion;
              switch (kind) {
                case 'visible':
                  nextAssertion = { kind: 'visible', locator };
                  break;
                case 'hidden':
                  nextAssertion = { kind: 'hidden', locator };
                  break;
                case 'text':
                  nextAssertion = {
                    kind: 'text',
                    locator,
                    matchMode: 'exact',
                    expected: { kind: 'literal', value: '' },
                  };
                  break;
                case 'value':
                  nextAssertion = {
                    kind: 'value',
                    locator,
                    expected: { kind: 'literal', value: '' },
                  };
                  break;
                case 'checked':
                  nextAssertion = { kind: 'checked', locator, expected: true };
                  break;
              }
              onChange({ ...step, assertion: nextAssertion });
            }}
          >
            <option value="visible">visible</option>
            <option value="hidden">hidden</option>
            <option value="text">text</option>
            <option value="value">field value</option>
            <option value="checked">checked state</option>
          </select>
        </label>
      ) : null}

      {assertion.kind === 'url' ? (
        <>
          <label>
            URL match mode
            <select
              value={
                assertion.matchMode ??
                (assertion.operator === 'equals' ? 'origin_and_path' : 'origin')
              }
              disabled={readOnly}
              onChange={(event) =>
                onChange({
                  ...step,
                  assertion: {
                    kind: 'url',
                    matchMode: event.currentTarget.value as
                      'origin' | 'origin_and_path',
                    expected: assertion.expected,
                  },
                })
              }
            >
              <option value="origin">origin</option>
              <option value="origin_and_path">origin and path</option>
            </select>
          </label>
          <ValueSourceField
            label="Expected URL"
            source={assertion.expected}
            target="verify.url.expected"
            variables={variables}
            readOnly={readOnly}
            summarizeStringLiteral={summarizeNavigateUrl}
            onChange={(expected) =>
              onValueSourceChange('verify.url.expected', expected)
            }
          />
        </>
      ) : null}

      {assertion.kind === 'text' ? (
        <>
          <label>
            Text match mode
            <select
              value={
                assertion.matchMode ??
                (assertion.operator === 'equals' ? 'exact' : 'contains')
              }
              disabled={readOnly}
              onChange={(event) =>
                onChange({
                  ...step,
                  assertion: {
                    kind: 'text',
                    locator: assertion.locator,
                    matchMode: event.currentTarget.value as
                      'exact' | 'contains',
                    expected: assertion.expected,
                  },
                })
              }
            >
              <option value="exact">exact</option>
              <option value="contains">contains</option>
            </select>
          </label>
          <ValueSourceField
            label="Expected text"
            source={assertion.expected}
            target="verify.text.expected"
            variables={variables}
            readOnly={readOnly}
            onChange={(expected) =>
              onValueSourceChange('verify.text.expected', expected)
            }
          />
        </>
      ) : null}

      {assertion.kind === 'value' ? (
        <ValueSourceField
          label="Expected field value"
          source={assertion.expected}
          target="verify.value.expected"
          variables={variables}
          readOnly={readOnly}
          onChange={(expected) =>
            onValueSourceChange('verify.value.expected', expected)
          }
        />
      ) : null}

      {assertion.kind === 'checked' ? (
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={assertion.expected}
            disabled={readOnly}
            onChange={(event) =>
              onChange({
                ...step,
                assertion: {
                  ...assertion,
                  expected: event.currentTarget.checked,
                },
              })
            }
          />
          Expected checked state
        </label>
      ) : null}

      <label>
        Verification timeout (milliseconds)
        <input
          type="number"
          min={100}
          max={60_000}
          value={step.timeoutMs ?? 5_000}
          disabled={readOnly}
          onChange={(event) =>
            onChange({ ...step, timeoutMs: Number(event.currentTarget.value) })
          }
        />
      </label>
    </div>
  );
}

export function StepInspector({
  step,
  variables,
  readOnly,
  locatorMetadata,
  onChange,
  onValueSourceChange,
}: StepInspectorProps) {
  const locator = locatorForStep(step);
  const evidence = locatorMetadata.find((item) => item.stepId === step.id);

  return (
    <section className="inspector" aria-labelledby="inspector-heading">
      <div className="section-heading">
        <p className="eyebrow">Selected step</p>
        <h2 id="inspector-heading">{step.type}</h2>
      </div>
      <label>
        Step name
        <input
          value={step.name}
          disabled={readOnly}
          maxLength={200}
          onChange={(event) =>
            onChange({ ...step, name: event.currentTarget.value })
          }
        />
      </label>

      {locator === null ? null : (
        <div className="locator-summary">
          <strong>Read-only locator</strong>
          <span>Kind: {locator.kind}</span>
          <span>Semantic target: {step.name || 'Unnamed step'}</span>
          {evidence === undefined ? null : (
            <>
              <span>Confidence: {evidence.confidence}</span>
              <span>Provenance: {evidence.provenance}</span>
            </>
          )}
        </div>
      )}

      {step.type === 'navigate' ? (
        <ValueSourceField
          label="URL"
          source={step.url}
          target="navigate.url"
          variables={variables}
          readOnly={readOnly}
          summarizeStringLiteral={summarizeNavigateUrl}
          onChange={(source) => onValueSourceChange('navigate.url', source)}
        />
      ) : null}

      {step.type === 'fill' || step.type === 'select' ? (
        <ValueSourceField
          label={step.type === 'fill' ? 'Value' : 'Selected value'}
          source={step.value}
          target={step.type === 'fill' ? 'fill.value' : 'select.value'}
          variables={variables}
          readOnly={readOnly}
          onChange={(source) =>
            onValueSourceChange(
              step.type === 'fill' ? 'fill.value' : 'select.value',
              source,
            )
          }
        />
      ) : null}

      {step.type === 'setChecked' ? (
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={step.checked}
            disabled={readOnly}
            onChange={(event) =>
              onChange({ ...step, checked: event.currentTarget.checked })
            }
          />
          Checked
        </label>
      ) : null}

      {step.type === 'wait' ? (
        <label>
          Duration (milliseconds)
          <input
            type="number"
            min={1}
            max={300_000}
            value={step.durationMs}
            disabled={readOnly}
            onChange={(event) =>
              onChange({
                ...step,
                durationMs: Number(event.currentTarget.value),
              })
            }
          />
        </label>
      ) : null}

      {step.type === 'approval' ? (
        <label>
          Approval message
          <textarea
            value={step.message}
            disabled={readOnly}
            maxLength={1_000}
            onChange={(event) =>
              onChange({ ...step, message: event.currentTarget.value })
            }
          />
        </label>
      ) : null}

      {step.type === 'extract' ? (
        <>
          <label>
            Output name
            <input
              value={step.outputName}
              disabled={readOnly}
              maxLength={128}
              onChange={(event) =>
                onChange({ ...step, outputName: event.currentTarget.value })
              }
            />
          </label>
          <p className="reference-summary">
            Extract source: {step.source.kind}
            {step.source.kind === 'attribute' ? ` (${step.source.name})` : ''}
          </p>
        </>
      ) : null}

      {step.type === 'verify' ? (
        <VerifyFields
          step={step}
          variables={variables}
          readOnly={readOnly}
          onChange={onChange}
          onValueSourceChange={onValueSourceChange}
        />
      ) : null}
    </section>
  );
}
