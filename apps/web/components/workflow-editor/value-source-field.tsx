'use client';

import {
  getValueSourceCompatibility,
  type ValueSourceTarget,
} from '@tasktwin/workflow-inputs';
import type { ValueSource, WorkflowVariable } from '@tasktwin/workflow-schema';
import type { WorkflowOutputDefinition } from '@tasktwin/workflow-extraction';
import { isOutputTypeCompatible } from '@tasktwin/workflow-extraction';

interface ValueSourceFieldProps {
  label: string;
  source: ValueSource;
  target: ValueSourceTarget;
  variables: WorkflowVariable[];
  outputs?: WorkflowOutputDefinition[];
  readOnly: boolean;
  summarizeStringLiteral?: (value: string) => string;
  onChange(source: ValueSource): void;
}

export function ValueSourceField({
  label,
  source,
  target,
  variables,
  outputs = [],
  readOnly,
  summarizeStringLiteral,
  onChange,
}: ValueSourceFieldProps) {
  const compatibility = getValueSourceCompatibility(target);
  const compatibleVariables = variables.filter((variable) =>
    compatibility.variableTypes.includes(variable.valueType),
  );
  const compatibleOutputs = outputs.filter((output) =>
    isOutputTypeCompatible(target, output.valueType),
  );

  function changeKind(kind: ValueSource['kind']): void {
    if (kind === source.kind) {
      return;
    }
    if (kind === 'literal') {
      const literalType = compatibility.literalTypes[0] ?? 'string';
      onChange({
        kind: 'literal',
        value:
          literalType === 'number' ? 0 : literalType === 'boolean' ? false : '',
      });
      return;
    }
    if (kind === 'variable') {
      const variable = compatibleVariables[0];
      if (variable !== undefined) {
        onChange({ kind: 'variable', variableName: variable.name });
      }
      return;
    }
    if (kind === 'output') {
      const output = compatibleOutputs[0];
      if (output !== undefined) {
        onChange({ kind: 'output', outputName: output.name });
      }
      return;
    }
    onChange({ kind: 'secret', secretName: 'secretReference' });
  }

  return (
    <fieldset className="value-source-field">
      <legend>{label}</legend>
      <label>
        Source
        <select
          aria-label={`${label} source`}
          value={source.kind}
          disabled={readOnly}
          onChange={(event) =>
            changeKind(event.currentTarget.value as ValueSource['kind'])
          }
        >
          <option value="literal">Literal</option>
          <option
            value="variable"
            disabled={
              compatibleVariables.length === 0 && source.kind !== 'variable'
            }
          >
            Variable
          </option>
          {compatibility.allowsSecret ? (
            <option value="secret">Secret reference</option>
          ) : null}
          <option
            value="output"
            disabled={
              compatibleOutputs.length === 0 && source.kind !== 'output'
            }
          >
            Runtime output
          </option>
        </select>
      </label>

      {source.kind === 'variable' ? (
        <label>
          Compatible variable
          <select
            value={source.variableName}
            disabled={readOnly}
            onChange={(event) =>
              onChange({
                kind: 'variable',
                variableName: event.currentTarget.value,
              })
            }
          >
            {compatibleVariables.some(
              (variable) => variable.name === source.variableName,
            ) ? null : (
              <option value={source.variableName} disabled>
                Incompatible or missing reference
              </option>
            )}
            {compatibleVariables.map((variable) => (
              <option key={variable.name} value={variable.name}>
                {variable.label ?? variable.name} ({variable.valueType})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {source.kind === 'secret' ? (
        <label>
          Secret reference alias
          <input
            value={source.secretName}
            disabled={readOnly}
            maxLength={80}
            autoComplete="off"
            aria-describedby={`${target}-secret-help`}
            onChange={(event) =>
              onChange({
                kind: 'secret',
                secretName: event.currentTarget.value,
              })
            }
          />
          <small id={`${target}-secret-help`}>
            Enter an alias only. Secret value is never displayed or requested.
          </small>
        </label>
      ) : null}

      {source.kind === 'output' ? (
        <label>
          Compatible earlier output
          <select
            value={source.outputName}
            disabled={readOnly}
            onChange={(event) =>
              onChange({
                kind: 'output',
                outputName: event.currentTarget.value,
              })
            }
          >
            {compatibleOutputs.some(
              (output) => output.name === source.outputName,
            ) ? null : (
              <option value={source.outputName} disabled>
                Incompatible, missing, or not produced yet
              </option>
            )}
            {compatibleOutputs.map((output) => (
              <option key={output.name} value={output.name}>
                {output.label ?? output.name} ({output.valueType})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {source.kind === 'literal' && typeof source.value === 'boolean' ? (
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={source.value}
            disabled={readOnly}
            onChange={(event) =>
              onChange({ kind: 'literal', value: event.currentTarget.checked })
            }
          />
          Literal value
        </label>
      ) : null}

      {source.kind === 'literal' && typeof source.value !== 'boolean' ? (
        <label>
          Literal value
          <input
            type={typeof source.value === 'number' ? 'number' : 'text'}
            value={
              typeof source.value === 'string' && summarizeStringLiteral
                ? summarizeStringLiteral(source.value)
                : source.value
            }
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
      ) : null}
    </fieldset>
  );
}
