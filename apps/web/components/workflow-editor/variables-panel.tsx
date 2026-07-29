'use client';

import {
  addVariable,
  findVariableUsages,
  removeVariable,
  renameVariable,
  updateVariable,
  type WorkflowVariableOperationResult,
} from '@tasktwin/workflow-editor-core';
import {
  MAX_WORKFLOW_VARIABLE_DESCRIPTION_LENGTH,
  MAX_WORKFLOW_VARIABLE_LABEL_LENGTH,
  type WorkflowDefinition,
  type WorkflowVariable,
  type WorkflowVariableValueType,
} from '@tasktwin/workflow-schema';
import { useMemo, useState } from 'react';

interface VariablesPanelProps {
  definition: WorkflowDefinition;
  readOnly: boolean;
  onChange(definition: WorkflowDefinition): void;
  onSelectStep(stepId: string): void;
}

export function VariablesPanel({
  definition,
  readOnly,
  onChange,
  onSelectStep,
}: VariablesPanelProps) {
  const [selectedName, setSelectedName] = useState<string | null>(
    definition.variables[0]?.name ?? null,
  );
  const [newName, setNewName] = useState('');
  const [renameDraft, setRenameDraft] = useState(
    definition.variables[0]?.name ?? '',
  );
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const selected = definition.variables.find(
    (variable) => variable.name === selectedName,
  );
  const usages = useMemo(
    () =>
      selectedName === null ? [] : findVariableUsages(definition, selectedName),
    [definition, selectedName],
  );

  function selectVariable(name: string | null): void {
    setSelectedName(name);
    setRenameDraft(name ?? '');
    setConfirmingDelete(false);
    setError('');
  }

  function applyResult(result: WorkflowVariableOperationResult): boolean {
    if (!result.ok) {
      setError(result.error.message);
      return false;
    }
    setError('');
    onChange(result.workflow);
    return true;
  }

  function add(): void {
    const name = newName.trim();
    if (name === '') {
      setError('Enter a valid variable name.');
      return;
    }
    const result = addVariable(definition, {
      name,
      valueType: 'string',
      required: false,
    });
    if (applyResult(result)) {
      setNewName('');
      selectVariable(name);
    }
  }

  function update(replacement: WorkflowVariable): void {
    if (selected !== undefined) {
      applyResult(updateVariable(definition, selected.name, replacement));
    }
  }

  function commitRename(): void {
    if (selected === undefined) {
      return;
    }
    const nextName = renameDraft.trim();
    const result = renameVariable(definition, selected.name, nextName);
    if (applyResult(result)) {
      selectVariable(nextName);
    }
  }

  function remove(): void {
    if (selected === undefined) {
      return;
    }
    const result = removeVariable(definition, selected.name);
    if (applyResult(result)) {
      selectVariable(
        result.ok ? (result.workflow.variables[0]?.name ?? null) : null,
      );
    }
  }

  return (
    <section
      className="panel variables-panel"
      aria-labelledby="variables-heading"
    >
      <div className="section-heading row-heading">
        <div>
          <p className="eyebrow">Declarations</p>
          <h2 id="variables-heading">Variables</h2>
        </div>
        <button
          type="button"
          onClick={() => selectVariable(definition.variables[0]?.name ?? null)}
        >
          View variables
        </button>
      </div>

      <div className="variable-add-row">
        <label>
          New variable name
          <input
            value={newName}
            disabled={readOnly}
            maxLength={80}
            placeholder="customerEmail"
            onChange={(event) => setNewName(event.currentTarget.value)}
          />
        </label>
        <button type="button" disabled={readOnly} onClick={add}>
          Add variable
        </button>
      </div>

      <div className="variables-layout">
        <ul className="variable-list" aria-label="Workflow variables">
          {definition.variables.map((variable) => {
            const usageCount = findVariableUsages(
              definition,
              variable.name,
            ).length;
            return (
              <li key={variable.name}>
                <button
                  type="button"
                  aria-pressed={selectedName === variable.name}
                  onClick={() => selectVariable(variable.name)}
                >
                  <span>{variable.label ?? variable.name}</span>
                  <small>
                    {variable.valueType} · {usageCount} usage
                    {usageCount === 1 ? '' : 's'}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>

        {selected === undefined ? (
          <p>No variable selected.</p>
        ) : (
          <div className="variable-editor">
            <label>
              Name
              <input
                value={renameDraft}
                disabled={readOnly}
                maxLength={80}
                onChange={(event) => setRenameDraft(event.currentTarget.value)}
              />
            </label>
            <button
              type="button"
              disabled={readOnly || renameDraft.trim() === selected.name}
              onClick={commitRename}
            >
              Rename and update references
            </button>
            <label>
              Label
              <input
                value={selected.label ?? ''}
                disabled={readOnly}
                maxLength={MAX_WORKFLOW_VARIABLE_LABEL_LENGTH}
                onChange={(event) => {
                  const label = event.currentTarget.value;
                  const replacement = { ...selected };
                  if (label === '') {
                    delete replacement.label;
                  } else {
                    replacement.label = label;
                  }
                  update(replacement);
                }}
              />
            </label>
            <label>
              Type
              <select
                value={selected.valueType}
                disabled={readOnly}
                onChange={(event) =>
                  update({
                    ...selected,
                    valueType: event.currentTarget
                      .value as WorkflowVariableValueType,
                  })
                }
              >
                <option value="string">String</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
                <option value="date">Date</option>
                <option value="file">File</option>
              </select>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={selected.required}
                disabled={readOnly}
                onChange={(event) =>
                  update({ ...selected, required: event.currentTarget.checked })
                }
              />
              Required at run time
            </label>
            <label>
              Description
              <textarea
                value={selected.description ?? ''}
                disabled={readOnly}
                maxLength={MAX_WORKFLOW_VARIABLE_DESCRIPTION_LENGTH}
                onChange={(event) => {
                  const description = event.currentTarget.value;
                  const replacement = { ...selected };
                  if (description === '') {
                    delete replacement.description;
                  } else {
                    replacement.description = description;
                  }
                  update(replacement);
                }}
              />
            </label>

            <div>
              <strong>Used by {usages.length} step(s)</strong>
              {usages.length === 0 ? (
                <p>This variable is currently unused.</p>
              ) : (
                <ul className="usage-list">
                  {usages.map((usage) => (
                    <li key={`${usage.stepId}:${usage.target}`}>
                      <button
                        type="button"
                        onClick={() => onSelectStep(usage.stepId)}
                      >
                        {usage.stepId} · {usage.target}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {usages.length > 0 ? (
              <p className="info-banner" role="status">
                Remove is blocked until all references are changed.
              </p>
            ) : confirmingDelete ? (
              <div className="button-group">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={remove}
                >
                  Confirm remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="danger-button"
                disabled={readOnly}
                onClick={() => setConfirmingDelete(true)}
              >
                Remove unused variable
              </button>
            )}
          </div>
        )}
      </div>

      {error === '' ? null : (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
