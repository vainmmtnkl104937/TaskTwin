'use client';

import {
  addApprovalStep,
  addElementVerifyStep,
  addUrlVerifyStep,
  addWaitStep,
  addElementExtractStep,
  addUrlExtractStep,
  removeExtractStep,
  moveWorkflowStepDown,
  moveWorkflowStepUp,
  removeWorkflowStep,
  listReusableStepLocators,
  updateStepValueSource,
  updateWorkflowMetadata,
  updateWorkflowStep,
  validateEditorWorkflow,
} from '@tasktwin/workflow-editor-core';
import {
  WorkflowDefinitionSchema,
  type ValueSource,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@tasktwin/workflow-schema';
import type { ValueSourceTarget } from '@tasktwin/workflow-inputs';
import { analyzePublishReadiness } from '@tasktwin/workflow-lifecycle';
import { analyzeWorkflowExtraction } from '@tasktwin/workflow-extraction';
import {
  evaluateWorkflowPolicy,
  DEFAULT_WORKSPACE_EXECUTION_POLICY,
  type WorkspaceExecutionPolicyDefinition,
} from '@tasktwin/workflow-policy';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import type { WorkflowVersionDetailResponse } from '@/lib/control-plane-contracts';
import {
  saveWorkflowDraftAction,
  type SaveWorkflowDraftResult,
} from '@/app/(authenticated)/workspaces/[workspaceId]/workflows/[workflowId]/versions/[versionId]/edit/actions';

import { LifecycleActions } from '../workflow-lifecycle/lifecycle-actions';
import { LifecycleStatusBadge } from '../workflow-lifecycle/lifecycle-status-badge';
import { PublishReadinessPanel } from '../workflow-lifecycle/publish-readiness-panel';
import { RunInputsPreview } from './run-inputs-preview';
import { StepInspector } from './step-inspector';
import { ValidationPanel } from './validation-panel';
import { VariablesPanel } from './variables-panel';
import { WorkflowGraph } from './workflow-graph';
import { OutputsPanel } from './outputs-panel';

interface WorkflowEditorProps {
  detail: WorkflowVersionDetailResponse;
  workspaceId: string;
  executionPolicy?: WorkspaceExecutionPolicyDefinition;
}

export function WorkflowEditor({
  detail,
  workspaceId,
  executionPolicy = DEFAULT_WORKSPACE_EXECUTION_POLICY,
}: WorkflowEditorProps) {
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
  const [showRunInputs, setShowRunInputs] = useState(false);
  const [pendingDeleteStepId, setPendingDeleteStepId] = useState<string | null>(
    null,
  );
  const reusableLocators = useMemo(
    () => listReusableStepLocators(definition),
    [definition],
  );
  const [locatorSourceStepId, setLocatorSourceStepId] = useState(
    reusableLocators[0]?.stepId ?? '',
  );
  const readOnly =
    !detail.access.canEdit || detail.workflowVersion.status !== 'draft';
  const issues = useMemo(
    () => validateEditorWorkflow(definition),
    [definition],
  );
  const publishReadiness = useMemo(
    () => analyzePublishReadiness(definition, executionPolicy),
    [definition, executionPolicy],
  );
  const policyEvaluation = useMemo(
    () =>
      evaluateWorkflowPolicy({
        policy: executionPolicy,
        workflow: definition,
        policyDigest: '0'.repeat(64),
        workflowDigest: '0'.repeat(64),
      }),
    [definition, executionPolicy],
  );
  const extractionAnalysis = useMemo(
    () => analyzeWorkflowExtraction(definition),
    [definition],
  );
  const canPublish =
    detail.access.role === 'OWNER' || detail.access.role === 'ADMIN';
  const selectedIndex = definition.steps.findIndex(
    (step) => step.id === selectedStepId,
  );
  const selectedStep =
    selectedIndex === -1 ? undefined : definition.steps[selectedIndex];
  const availableOutputs = extractionAnalysis.outputs.filter(
    (output) => output.producerStepIndex < selectedIndex,
  );

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

  function updateValueSource(
    target: ValueSourceTarget,
    source: ValueSource,
  ): void {
    if (readOnly || selectedStep === undefined) {
      return;
    }
    const result = updateStepValueSource(
      definition,
      selectedStep.id,
      target,
      source,
    );
    if (!result.ok) {
      setSaveState('error');
      setSaveMessage(result.error.message);
      return;
    }
    apply(result.workflow);
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
    if (selectedIndex < 0) return;
    const id = `step-${crypto.randomUUID()}`;
    apply(
      addApprovalStep(
        definition,
        {
          id,
          name: 'Approval',
          message: 'Review and approve before continuing.',
          riskLevel: 'medium',
          scope: 'next_step',
          timeoutMs: 120_000,
        },
        selectedIndex,
      ),
    );
    setSelectedStepId(id);
  }

  function addUrlVerify(): void {
    const id = `step-${crypto.randomUUID()}`;
    apply(addUrlVerifyStep(definition, { id, name: 'Verify current URL' }));
    setSelectedStepId(id);
  }

  function addElementVerify(): void {
    if (locatorSourceStepId === '') return;
    const id = `step-${crypto.randomUUID()}`;
    apply(
      addElementVerifyStep(definition, locatorSourceStepId, {
        id,
        name: 'Verify element is visible',
      }),
    );
    setSelectedStepId(id);
  }

  function addUrlExtract(): void {
    const id = `step-${crypto.randomUUID()}`;
    const outputName = `output_${crypto.randomUUID().replaceAll('-', '_')}`;
    apply(
      addUrlExtractStep(definition, {
        id,
        name: 'Extract current URL',
        outputName,
        outputLabel: 'Current URL',
        timeoutMs: 5_000,
      }),
    );
    setSelectedStepId(id);
  }

  function addElementExtract(): void {
    if (locatorSourceStepId === '') return;
    const id = `step-${crypto.randomUUID()}`;
    const result = addElementExtractStep(definition, locatorSourceStepId, {
      id,
      name: 'Extract element text',
      outputName: `output_${crypto.randomUUID().replaceAll('-', '_')}`,
      outputLabel: 'Extracted text',
      timeoutMs: 5_000,
    });
    if (!result.ok) {
      setSaveState('error');
      setSaveMessage(result.error.message);
      return;
    }
    apply(result.workflow);
    setSelectedStepId(id);
  }

  function confirmDelete(): void {
    if (pendingDeleteStepId === null) {
      return;
    }
    const pending = definition.steps.find(
      (step) => step.id === pendingDeleteStepId,
    );
    const removal =
      pending?.type === 'extract'
        ? removeExtractStep(definition, pendingDeleteStepId)
        : {
            ok: true as const,
            workflow: removeWorkflowStep(definition, pendingDeleteStepId),
          };
    if (!removal.ok) {
      setSaveState('error');
      setSaveMessage(removal.error.message);
      setPendingDeleteStepId(null);
      return;
    }
    const next = removal.workflow;
    apply(next);
    setPendingDeleteStepId(null);
    setSelectedStepId(next.steps[0]?.id ?? null);
  }

  return (
    <main className="editor-page">
      <nav aria-label="Breadcrumb">
        <Link
          href={`/workspaces/${workspaceId}/workflows/${encodeURIComponent(detail.workflowVersion.workflowId)}/versions`}
          onClick={(event) => {
            if (
              dirty &&
              !window.confirm('Leave without saving your draft changes?')
            ) {
              event.preventDefault();
            }
          }}
        >
          Version history
        </Link>
      </nav>
      <header className="editor-header">
        <div>
          <p className="eyebrow">Workflow version</p>
          <h1>{definition.name || 'Unnamed workflow'}</h1>
          <p className="metadata">
            Version {definition.version} · Revision {revision} ·{' '}
            {readOnly ? 'Read only' : dirty ? 'Unsaved changes' : 'Saved'}
          </p>
          <LifecycleStatusBadge status={detail.workflowVersion.status} />
        </div>
        <div className="button-group">
          <button type="button" onClick={() => setShowRunInputs(true)}>
            Preview run inputs
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={
              readOnly || !dirty || issues.length > 0 || saveState === 'saving'
            }
          >
            {saveState === 'saving' ? 'Saving…' : 'Save draft'}
          </button>
        </div>
      </header>

      <LifecycleActions
        workflowId={detail.workflowVersion.workflowId}
        workspaceId={workspaceId}
        versionId={detail.workflowVersion.id}
        revision={revision}
        status={detail.workflowVersion.status}
        canEdit={detail.access.role !== 'VIEWER'}
        canPublish={canPublish}
        dirty={dirty}
        readiness={publishReadiness}
      />

      {readOnly ? (
        <p className="info-banner" role="status">
          {detail.workflowVersion.status === 'draft'
            ? 'You have read-only access to this Draft.'
            : `${detail.workflowVersion.status} versions are immutable. Create or return to a Draft to edit.`}
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

      <VariablesPanel
        definition={definition}
        readOnly={readOnly}
        onChange={apply}
        onSelectStep={setSelectedStepId}
      />
      <OutputsPanel
        definition={definition}
        readOnly={readOnly}
        onChange={apply}
        onSelectStep={setSelectedStepId}
        onError={(message) => {
          setSaveState('error');
          setSaveMessage(message);
        }}
      />

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
              <button
                type="button"
                onClick={addApproval}
                disabled={readOnly || selectedIndex < 0}
              >
                Add Approval
              </button>
              <button type="button" onClick={addUrlVerify} disabled={readOnly}>
                Add URL Verify
              </button>
              <button type="button" onClick={addUrlExtract} disabled={readOnly}>
                Add URL Extract
              </button>
              <select
                aria-label="Locator source step"
                value={locatorSourceStepId}
                disabled={readOnly || reusableLocators.length === 0}
                onChange={(event) =>
                  setLocatorSourceStepId(event.currentTarget.value)
                }
              >
                {reusableLocators.map((item) => (
                  <option key={item.stepId} value={item.stepId}>
                    {item.stepName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addElementVerify}
                disabled={
                  readOnly ||
                  reusableLocators.length === 0 ||
                  locatorSourceStepId === ''
                }
              >
                Add Element Verify
              </button>
              <button
                type="button"
                onClick={addElementExtract}
                disabled={
                  readOnly ||
                  reusableLocators.length === 0 ||
                  locatorSourceStepId === ''
                }
              >
                Add Text Extract
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
                {...(selectedStep.type === 'approval' &&
                definition.steps[selectedIndex + 1] !== undefined
                  ? { gatedStep: definition.steps[selectedIndex + 1] }
                  : {})}
                variables={definition.variables}
                outputs={availableOutputs}
                readOnly={readOnly}
                locatorMetadata={detail.locatorMetadata}
                {...(policyEvaluation.steps[selectedIndex] === undefined
                  ? {}
                  : {
                      policyEvaluation:
                        policyEvaluation.steps[selectedIndex],
                    })}
                onChange={updateStep}
                onValueSourceChange={updateValueSource}
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
      <PublishReadinessPanel report={publishReadiness} />

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

      {showRunInputs ? (
        <RunInputsPreview
          definition={definition}
          onClose={() => setShowRunInputs(false)}
        />
      ) : null}
    </main>
  );
}
