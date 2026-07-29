'use client';

import {
  addApprovalStep,
  addWaitStep,
  moveWorkflowStepDown,
  moveWorkflowStepUp,
  removeWorkflowStep,
  updateWorkflowMetadata,
  updateWorkflowStep,
  validateEditorWorkflow,
} from '@tasktwin/workflow-editor-core';
import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@tasktwin/workflow-schema';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import type { WorkflowVersionDetailResponse } from '@/lib/control-plane-contracts';
import {
  saveWorkflowDraftAction,
  type SaveWorkflowDraftResult,
} from '@/app/(authenticated)/workspaces/[workspaceId]/workflows/[workflowId]/versions/[versionId]/edit/actions';

import { StepInspector } from './step-inspector';
import { ValidationPanel } from './validation-panel';
import { WorkflowGraph } from './workflow-graph';

interface WorkflowEditorProps {
  detail: WorkflowVersionDetailResponse;
  workspaceId: string;
}

export function WorkflowEditor({ detail, workspaceId }: WorkflowEditorProps) {
  const initialDefinition = detail.workflowVersion.definition;
  const [definition, setDefinition] =
    useState<WorkflowDefinition>(initialDefinition);
  const [revision, setRevision] = useState(detail.workflowVersion.revision);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(
    initialDefinition.steps[0]?.id ?? null,
  );
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error' | 'conflict'
  >('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [pendingDeleteStepId, setPendingDeleteStepId] = useState<string | null>(
    null,
  );
  const readOnly =
    !detail.access.canEdit || detail.workflowVersion.status !== 'draft';
  const issues = useMemo(
    () => validateEditorWorkflow(definition),
    [definition],
  );
  const selectedIndex = definition.steps.findIndex(
    (step) => step.id === selectedStepId,
  );
  const selectedStep =
    selectedIndex === -1 ? undefined : definition.steps[selectedIndex];

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function apply(next: WorkflowDefinition): void {
    if (next !== definition) {
      setDefinition(next);
      setDirty(true);
      setSaveState('idle');
      setSaveMessage('');
    }
  }

  function updateStep(step: WorkflowStep): void {
    if (!readOnly) {
      apply(updateWorkflowStep(definition, step.id, step));
    }
  }

  async function save(): Promise<void> {
    if (readOnly || !dirty || issues.length > 0) {
      return;
    }
    setSaveState('saving');
    const result: SaveWorkflowDraftResult = await saveWorkflowDraftAction(
      detail.workflowVersion.id,
      revision,
      definition,
    );
    if (result.status === 'success') {
      const parsed = WorkflowDefinitionSchema.safeParse(result.definition);
      if (!parsed.success) {
        setSaveState('error');
        setSaveMessage('The saved workflow response was invalid.');
        return;
      }
      setDefinition(parsed.data);
      setRevision(result.revision);
      setDirty(false);
      setSaveState('saved');
      setSaveMessage(`Draft saved at revision ${result.revision}.`);
      return;
    }
    if (result.status === 'conflict') {
      setSaveState('conflict');
      setSaveMessage(result.message);
      return;
    }
    setSaveState('error');
    setSaveMessage(result.message);
  }

  function addWait(): void {
    const id = `step-${crypto.randomUUID()}`;
    apply(
      addWaitStep(definition, {
        id,
        name: 'Wait',
        durationMs: 1_000,
      }),
    );
    setSelectedStepId(id);
  }

  function addApproval(): void {
    const id = `step-${crypto.randomUUID()}`;
    apply(
      addApprovalStep(definition, {
        id,
        name: 'Approval',
        message: 'Review and approve before continuing.',
      }),
    );
    setSelectedStepId(id);
  }

  function confirmDelete(): void {
    if (pendingDeleteStepId === null) {
      return;
    }
    const next = removeWorkflowStep(definition, pendingDeleteStepId);
    apply(next);
    setPendingDeleteStepId(null);
    setSelectedStepId(next.steps[0]?.id ?? null);
  }

  return (
    <main className="editor-page">
      <nav aria-label="Breadcrumb">
        <Link
          href={`/workspaces/${workspaceId}/workflows`}
          onClick={(event) => {
            if (
              dirty &&
              !window.confirm('Leave without saving your draft changes?')
            ) {
              event.preventDefault();
            }
          }}
        >
          Workflows
        </Link>
      </nav>
      <header className="editor-header">
        <div>
          <p className="eyebrow">Draft workflow editor</p>
          <h1>{definition.name || 'Unnamed workflow'}</h1>
          <p className="metadata">
            Version {definition.version} · Draft revision {revision} ·{' '}
            {readOnly ? 'Read only' : dirty ? 'Unsaved changes' : 'Saved'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={
            readOnly || !dirty || issues.length > 0 || saveState === 'saving'
          }
        >
          {saveState === 'saving' ? 'Saving…' : 'Save draft'}
        </button>
      </header>

      {readOnly ? (
        <p className="info-banner" role="status">
          You have read-only access to this workflow version.
        </p>
      ) : null}
      {saveMessage === '' ? null : (
        <p
          className={saveState === 'saved' ? 'success-banner' : 'error-banner'}
          role="status"
          aria-live="polite"
        >
          {saveMessage}
        </p>
      )}

      <section className="panel workflow-metadata">
        <label>
          Workflow name
          <input
            value={definition.name}
            disabled={readOnly}
            maxLength={200}
            onChange={(event) =>
              apply(
                updateWorkflowMetadata(definition, {
                  name: event.currentTarget.value,
                }),
              )
            }
          />
        </label>
        <label>
          Description
          <textarea
            value={definition.description ?? ''}
            disabled={readOnly}
            maxLength={1_000}
            onChange={(event) =>
              apply(
                updateWorkflowMetadata(definition, {
                  description:
                    event.currentTarget.value === ''
                      ? undefined
                      : event.currentTarget.value,
                }),
              )
            }
          />
        </label>
      </section>

      <div className="editor-grid">
        <section className="panel graph-panel" aria-labelledby="steps-heading">
          <div className="section-heading row-heading">
            <div>
              <p className="eyebrow">Execution order</p>
              <h2 id="steps-heading">Steps</h2>
            </div>
            <div className="button-group">
              <button type="button" onClick={addWait} disabled={readOnly}>
                Add Wait
              </button>
              <button type="button" onClick={addApproval} disabled={readOnly}>
                Add Approval
              </button>
            </div>
          </div>
          <WorkflowGraph
            definition={definition}
            selectedStepId={selectedStepId}
            onSelectStep={setSelectedStepId}
          />
        </section>

        <aside className="panel inspector-panel">
          {selectedStep === undefined ? (
            <p>Select a step to inspect it.</p>
          ) : (
            <>
              <StepInspector
                step={selectedStep}
                readOnly={readOnly}
                locatorMetadata={detail.locatorMetadata}
                onChange={updateStep}
              />
              <div className="step-actions">
                <button
                  type="button"
                  disabled={readOnly || selectedIndex <= 0}
                  onClick={() =>
                    apply(moveWorkflowStepUp(definition, selectedStep.id))
                  }
                >
                  Move up
                </button>
                <button
                  type="button"
                  disabled={
                    readOnly || selectedIndex >= definition.steps.length - 1
                  }
                  onClick={() =>
                    apply(moveWorkflowStepDown(definition, selectedStep.id))
                  }
                >
                  Move down
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={readOnly}
                  onClick={() => setPendingDeleteStepId(selectedStep.id)}
                >
                  Delete step
                </button>
              </div>
            </>
          )}
        </aside>
      </div>

      <ValidationPanel issues={issues} />

      {pendingDeleteStepId === null ? null : (
        <div className="dialog-backdrop">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-heading"
          >
            <h2 id="delete-heading">Delete this step?</h2>
            <p>The draft will not change on the server until you save.</p>
            <div className="button-group">
              <button
                type="button"
                onClick={() => setPendingDeleteStepId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={confirmDelete}
              >
                Delete
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
