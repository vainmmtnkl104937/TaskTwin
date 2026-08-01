'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WORKFLOW_VERIFICATION_CAPABILITY } from '@tasktwin/runner-protocol';
import type {
  RunInputPreparationMetadata,
  SecureRunInputManifest,
} from '@tasktwin/secure-run-inputs';
import {
  WorkflowRunInputSubmissionSchema,
  type RuntimeInputValue,
} from '@tasktwin/workflow-inputs';

import {
  commitWorkflowRunInputsAction,
  createWorkflowRunAction,
  prepareWorkflowRunInputsAction,
} from '@/app/(authenticated)/workspaces/[workspaceId]/runs/actions';
import { encryptRunInputs } from './encrypt-run-inputs';

export function RunWorkflowPanel({
  workspaceId,
  workflowVersionId,
  runners,
  manifest,
  requiresVerification,
}: {
  workspaceId: string;
  workflowVersionId: string;
  runners: Array<{
    id: string;
    name: string;
    status: string;
    capabilities: string[];
  }>;
  manifest: SecureRunInputManifest;
  requiresVerification?: boolean;
}) {
  const router = useRouter();
  const requiresSecureInputs =
    manifest.variables.length > 0 || manifest.secrets.length > 0;
  const compatibleRunners = runners.filter(
    (runner) =>
      (requiresVerification !== true ||
        runner.capabilities.includes(WORKFLOW_VERIFICATION_CAPABILITY)) &&
      (!requiresSecureInputs ||
        (runner.capabilities.includes('secure_input_envelope_v1') &&
          (manifest.secrets.length === 0 ||
            runner.capabilities.includes('interactive_secret_prompt_v1')))),
  );
  const [runnerId, setRunnerId] = useState(compatibleRunners[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [preparation, setPreparation] =
    useState<RunInputPreparationMetadata | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const clientRunId = useRef<string | undefined>(undefined);
  const clientPreparationId = useRef<string | undefined>(undefined);

  async function run() {
    if (runnerId === '') {
      setMessage('Select a compatible Local Runner.');
      return;
    }
    clientRunId.current ??= crypto.randomUUID();
    setPending(true);
    setMessage('');
    try {
      if (!requiresSecureInputs) {
        const result = await createWorkflowRunAction({
          workspaceId,
          workflowVersionId,
          runnerDeviceId: runnerId,
          clientRunId: clientRunId.current,
        });
        if (!result.ok) return setMessage(result.message);
        clientRunId.current = undefined;
        router.push(`/workspaces/${workspaceId}/runs/${result.runId}`);
        return;
      }
      if (preparation === null) {
        clientPreparationId.current ??= crypto.randomUUID();
        const result = await prepareWorkflowRunInputsAction({
          workspaceId,
          workflowVersionId,
          runnerDeviceId: runnerId,
          clientRunId: clientRunId.current,
          clientPreparationId: clientPreparationId.current,
        });
        if (!result.ok) return setMessage(result.message);
        setPreparation(result.preparation);
        setMessage(
          'Enter required variables. Secrets will be requested locally by the Runner.',
        );
        return;
      }
      const submission = buildSubmission(manifest, values);
      if (submission === null) {
        setMessage(
          'Enter every required runtime variable with the correct type.',
        );
        return;
      }
      const envelope = await encryptRunInputs(preparation, submission);
      const result = await commitWorkflowRunInputsAction({
        workspaceId,
        preparationId: preparation.preparationId,
        envelope,
      });
      if (!result.ok) return setMessage(result.message);
      setValues({});
      setPreparation(null);
      clientRunId.current = undefined;
      clientPreparationId.current = undefined;
      router.push(`/workspaces/${workspaceId}/runs/${result.runId}`);
    } catch {
      setMessage('The inputs could not be encrypted safely in this browser.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="run-workflow-panel">
      <label>
        Local Runner
        <select
          aria-label="Local Runner"
          value={runnerId}
          onChange={(event) => {
            setRunnerId(event.target.value);
            setPreparation(null);
            clientPreparationId.current = undefined;
          }}
        >
          {compatibleRunners.map((runner) => (
            <option key={runner.id} value={runner.id}>
              {runner.name} ({runner.status})
            </option>
          ))}
        </select>
      </label>
      {preparation === null
        ? null
        : manifest.variables.map((variable) => (
            <label key={variable.name}>
              {variable.label ?? variable.name}
              {variable.valueType === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={values[variable.name] === true}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [variable.name]: event.target.checked,
                    }))
                  }
                />
              ) : (
                <input
                  type={
                    variable.valueType === 'number'
                      ? 'number'
                      : variable.valueType === 'date'
                        ? 'date'
                        : 'text'
                  }
                  autoComplete="off"
                  value={String(values[variable.name] ?? '')}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [variable.name]: event.target.value,
                    }))
                  }
                />
              )}
            </label>
          ))}
      {preparation === null || manifest.secrets.length === 0 ? null : (
        <p className="metadata">
          {manifest.secrets.length} secret reference(s) will be resolved only in
          the Local Runner.
        </p>
      )}
      <button
        disabled={pending || compatibleRunners.length === 0}
        onClick={run}
      >
        {pending
          ? 'Preparing safely...'
          : preparation === null && requiresSecureInputs
            ? 'Prepare secure inputs'
            : 'Run'}
      </button>
      {message === '' ? null : <p className="inline-error">{message}</p>}
    </div>
  );
}

function buildSubmission(
  manifest: SecureRunInputManifest,
  raw: Record<string, string | boolean>,
) {
  const values: Record<string, RuntimeInputValue> = {};
  for (const variable of manifest.variables) {
    const value = raw[variable.name];
    if (value === undefined || value === '') {
      if (variable.requiredForRun) return null;
      continue;
    }
    switch (variable.valueType) {
      case 'string':
      case 'date':
        if (typeof value !== 'string') return null;
        values[variable.name] = { kind: variable.valueType, value };
        break;
      case 'number': {
        if (typeof value !== 'string' || value.trim() === '') return null;
        const number = Number(value);
        if (!Number.isFinite(number)) return null;
        values[variable.name] = { kind: 'number', value: number };
        break;
      }
      case 'boolean':
        if (typeof value !== 'boolean') return null;
        values[variable.name] = { kind: 'boolean', value };
        break;
    }
  }
  const parsed = WorkflowRunInputSubmissionSchema.safeParse({
    schemaVersion: 1,
    values,
  });
  return parsed.success ? parsed.data : null;
}
