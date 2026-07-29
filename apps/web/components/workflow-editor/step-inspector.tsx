'use client';

import { summarizeNavigateUrl } from '@tasktwin/workflow-editor-core';
import type {
  ElementLocator,
  ValueSource,
  VerifyStep,
  WorkflowStep,
} from '@tasktwin/workflow-schema';

import type { WorkflowVersionDetailResponse } from '@/lib/control-plane-contracts';

interface StepInspectorProps {
  step: WorkflowStep;
  readOnly: boolean;
  locatorMetadata: WorkflowVersionDetailResponse['locatorMetadata'];
  onChange(step: WorkflowStep): void;
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

function ValueSourceField({
  label,
  source,
  readOnly,
  onChange,
}: {
  label: string;
  source: ValueSource;
  readOnly: boolean;
  onChange(source: ValueSource): void;
}) {
  if (source.kind === 'variable') {
    return (
      <p className="reference-summary">
        {label}: Variable reference <code>{source.variableName}</code>
      </p>
    );
  }
  if (source.kind === 'secret') {
    return (
      <p className="reference-summary">
        {label}: Secret reference <code>{source.secretName}</code>. Secret value
        is never displayed.
      </p>
    );
  }
  if (typeof source.value === 'boolean') {
    return (
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={source.value}
          disabled={readOnly}
          onChange={(event) =>
            onChange({ kind: 'literal', value: event.currentTarget.checked })
          }
        />
        {label}
      </label>
    );
  }

  return (
    <label>
      {label}
      <input
        type={typeof source.value === 'number' ? 'number' : 'text'}
        value={source.value}
        disabled={readOnly}
        maxLength={typeof source.value === 'string' ? 1_024 : undefined}
        onChange={(event) =>
          onChange({
            kind: 'literal',
            value:
              typeof source.value === 'number'
                ? Number(event.currentTarget.value)
                : event.currentTarget.value,
          })
        }
      />
    </label>
  );
}

function VerifyFields({
  step,
  readOnly,
  onChange,
}: {
  step: VerifyStep;
  readOnly: boolean;
  onChange(step: VerifyStep): void;
}) {
  const assertion = step.assertion;
  if (assertion.kind === 'visible' || assertion.kind === 'hidden') {
    return <p className="reference-summary">Assertion: {assertion.kind}</p>;
  }

  return (
    <div className="reference-summary">
      <p>Assertion: {assertion.kind}</p>
      <label>
        Operator
        <select
          value={assertion.operator}
          disabled={readOnly}
          onChange={(event) =>
            onChange({
              ...step,
              assertion: {
                ...assertion,
                operator: event.currentTarget.value as 'equals' | 'contains',
              },
            })
          }
        >
          <option value="equals">equals</option>
          <option value="contains">contains</option>
        </select>
      </label>
      <ValueSourceField
        label="Expected value"
        source={assertion.expected}
        readOnly={readOnly}
        onChange={(expected) =>
          onChange({
            ...step,
            assertion: { ...assertion, expected },
          })
        }
      />
    </div>
  );
}

export function StepInspector({
  step,
  readOnly,
  locatorMetadata,
  onChange,
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
        step.url.kind === 'literal' && typeof step.url.value === 'string' ? (
          <label>
            URL
            <input
              type="url"
              value={summarizeNavigateUrl(step.url.value)}
              disabled={readOnly}
              maxLength={2_048}
              onChange={(event) =>
                onChange({
                  ...step,
                  url: { kind: 'literal', value: event.currentTarget.value },
                })
              }
            />
            <small>Query values and fragments are not displayed.</small>
          </label>
        ) : (
          <p className="reference-summary">
            Navigate URL uses a {step.url.kind} reference and is read-only.
          </p>
        )
      ) : null}

      {step.type === 'fill' || step.type === 'select' ? (
        <ValueSourceField
          label={step.type === 'fill' ? 'Value' : 'Selected value'}
          source={step.value}
          readOnly={readOnly}
          onChange={(value) => onChange({ ...step, value })}
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
        <VerifyFields step={step} readOnly={readOnly} onChange={onChange} />
      ) : null}
    </section>
  );
}
