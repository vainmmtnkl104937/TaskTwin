'use client';

import {
  prepareRunInputPlan,
  validateWorkflowRunInputs,
  type RuntimeInputValue,
} from '@tasktwin/workflow-inputs';
import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { useMemo, useState } from 'react';

interface RunInputsPreviewProps {
  definition: WorkflowDefinition;
  onClose(): void;
}

export function RunInputsPreview({
  definition,
  onClose,
}: RunInputsPreviewProps) {
  const plan = useMemo(() => prepareRunInputPlan(definition), [definition]);
  const [values, setValues] = useState<Record<string, RuntimeInputValue>>({});
  const [validated, setValidated] = useState(false);
  const result = validateWorkflowRunInputs(definition, {
    schemaVersion: 1,
    values,
  });

  function setValue(name: string, value: RuntimeInputValue): void {
    setValues((current) => ({ ...current, [name]: value }));
    setValidated(false);
  }

  return (
    <div className="dialog-backdrop">
      <section
        className="run-inputs-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-inputs-heading"
      >
        <div className="row-heading">
          <div>
            <p className="eyebrow">Local preview only</p>
            <h2 id="run-inputs-heading">Run Inputs Preview</h2>
          </div>
          <button type="button" onClick={onClose} autoFocus>
            Close and clear
          </button>
        </div>
        <p>
          Values stay in this dialog&apos;s memory. They are not saved, sent,
          logged, or executed.
        </p>

        {plan.variables.map((variable) => {
          const id = `run-input-${variable.name}`;
          const current = values[variable.name];
          return (
            <div className="run-input-field" key={variable.name}>
              <label htmlFor={id}>
                {variable.label ?? variable.name}
                {variable.required ? ' (required)' : ''}
              </label>
              {variable.description === undefined ? null : (
                <small>{variable.description}</small>
              )}
              {variable.valueType === 'string' ? (
                <input
                  id={id}
                  value={current?.kind === 'string' ? current.value : ''}
                  onChange={(event) =>
                    setValue(variable.name, {
                      kind: 'string',
                      value: event.currentTarget.value,
                    })
                  }
                />
              ) : null}
              {variable.valueType === 'number' ? (
                <input
                  id={id}
                  type="number"
                  value={current?.kind === 'number' ? current.value : ''}
                  onChange={(event) =>
                    setValue(variable.name, {
                      kind: 'number',
                      value: Number(event.currentTarget.value),
                    })
                  }
                />
              ) : null}
              {variable.valueType === 'boolean' ? (
                <input
                  id={id}
                  type="checkbox"
                  checked={current?.kind === 'boolean' && current.value}
                  onChange={(event) =>
                    setValue(variable.name, {
                      kind: 'boolean',
                      value: event.currentTarget.checked,
                    })
                  }
                />
              ) : null}
              {variable.valueType === 'date' ? (
                <input
                  id={id}
                  type="date"
                  value={current?.kind === 'date' ? current.value : ''}
                  onChange={(event) =>
                    setValue(variable.name, {
                      kind: 'date',
                      value: event.currentTarget.value,
                    })
                  }
                />
              ) : null}
              {variable.valueType === 'file' ? (
                <>
                  <input
                    id={id}
                    type="file"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file === undefined) {
                        return;
                      }
                      setValue(variable.name, {
                        kind: 'file',
                        metadata: {
                          sizeBytes: file.size,
                          ...(file.type === '' ? {} : { mediaType: file.type }),
                        },
                      });
                    }}
                  />
                  <small>
                    {current?.kind === 'file'
                      ? `Temporary file metadata: ${current.metadata.sizeBytes} bytes`
                      : 'No file metadata selected.'}{' '}
                    File content and filename are never read or uploaded.
                  </small>
                </>
              ) : null}
            </div>
          );
        })}

        <section aria-labelledby="secret-requirements-heading">
          <h3 id="secret-requirements-heading">Required secret references</h3>
          {plan.secretRequirements.length === 0 ? (
            <p>None.</p>
          ) : (
            <ul>
              {plan.secretRequirements.map((secret) => (
                <li key={secret.secretName}>
                  <code>{secret.secretName}</code> · {secret.usageCount}{' '}
                  usage(s)
                </li>
              ))}
            </ul>
          )}
          <p>No secret values are requested by this preview.</p>
        </section>

        <button type="button" onClick={() => setValidated(true)}>
          Validate temporary inputs
        </button>
        {validated ? (
          <div aria-live="polite">
            <p>
              {result.summary.valid
                ? 'Temporary inputs are valid.'
                : `${result.summary.issueCount} input issue(s) found.`}
            </p>
            <ul>
              {result.issues.map((issue) => (
                <li key={`${issue.code}:${issue.variableName ?? ''}`}>
                  {issue.variableName === undefined
                    ? issue.message
                    : `${issue.variableName}: ${issue.message}`}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
