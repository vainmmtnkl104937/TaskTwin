'use client';

import { analyzeWorkflowExtraction } from '@tasktwin/workflow-extraction';
import {
  removeExtractStep,
  renameWorkflowOutput,
} from '@tasktwin/workflow-editor-core';
import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { useMemo, useState } from 'react';

export function OutputsPanel({
  definition,
  readOnly,
  onChange,
  onSelectStep,
  onError,
}: {
  definition: WorkflowDefinition;
  readOnly: boolean;
  onChange(workflow: WorkflowDefinition): void;
  onSelectStep(stepId: string): void;
  onError(message: string): void;
}) {
  const analysis = useMemo(
    () => analyzeWorkflowExtraction(definition),
    [definition],
  );
  const [names, setNames] = useState<Record<string, string>>({});

  return (
    <section className="panel" aria-labelledby="outputs-heading">
      <div className="section-heading">
        <p className="eyebrow">Memory only</p>
        <h2 id="outputs-heading">Outputs</h2>
      </div>
      {analysis.outputs.length === 0 ? (
        <p>No Extract outputs are declared.</p>
      ) : (
        <ul className="reference-list">
          {analysis.outputs.map((output) => {
            const usages = analysis.usages.filter(
              (usage) => usage.outputName === output.name,
            );
            const nextName = names[output.name] ?? output.name;
            return (
              <li key={`${output.producerStepId}:${output.name}`}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onSelectStep(output.producerStepId)}
                >
                  {output.label ?? output.name}
                </button>
                <span>
                  {output.valueType} · ephemeral · {usages.length} usage(s)
                </span>
                <label>
                  Output name
                  <input
                    value={nextName}
                    disabled={readOnly}
                    maxLength={128}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setNames((current) => ({
                        ...current,
                        [output.name]: value,
                      }));
                    }}
                  />
                </label>
                <div className="button-group">
                  <button
                    type="button"
                    disabled={readOnly || nextName === output.name}
                    onClick={() => {
                      const result = renameWorkflowOutput(
                        definition,
                        output.name,
                        nextName,
                      );
                      if (!result.ok) return onError(result.error.message);
                      setNames({});
                      onChange(result.workflow);
                    }}
                  >
                    Rename output
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={readOnly || usages.length > 0}
                    title={
                      usages.length > 0
                        ? 'Remove all output references before deleting this Extract step.'
                        : undefined
                    }
                    onClick={() => {
                      const result = removeExtractStep(
                        definition,
                        output.producerStepId,
                      );
                      if (!result.ok) return onError(result.error.message);
                      onChange(result.workflow);
                    }}
                  >
                    Delete unused Extract
                  </button>
                </div>
                {usages.length === 0 ? (
                  <small>Unused output</small>
                ) : (
                  <small>
                    Consumers:{' '}
                    {usages.map((usage) => usage.consumerStepId).join(', ')}
                  </small>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
