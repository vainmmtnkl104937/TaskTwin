import {
  WorkflowDraftConversionResultSchema,
  type ConversionIssueCode,
} from '@tasktwin/recording-converter';

import {
  RecordingWorkflowDraftResponseSchema,
  type RecordingWorkflowDraftResponse,
} from './recording-workflow-draft.contracts.js';

export interface PersistedRecordingWorkflowDraft {
  conversion: {
    recordingSessionId: string;
    clientConversionId: string;
    workflowId: string;
    workflowVersionId: string;
    report: unknown;
    workflowDefinition: unknown;
  };
  idempotent: boolean;
}

export function toRecordingWorkflowDraftResponse(
  result: PersistedRecordingWorkflowDraft,
): RecordingWorkflowDraftResponse {
  const conversion = WorkflowDraftConversionResultSchema.parse({
    schemaVersion: 1,
    outcome: 'draft',
    workflowDefinition: result.conversion.workflowDefinition,
    report: result.conversion.report,
  });
  if (
    conversion.outcome !== 'draft' ||
    conversion.workflowDefinition === null
  ) {
    throw new Error('A persisted conversion must contain a draft workflow.');
  }

  const issueCounts = {
    info: 0,
    warning: 0,
    blocking: 0,
  };
  const issueCodes: ConversionIssueCode[] = [];
  const observedIssueCodes = new Set<ConversionIssueCode>();

  for (const issue of conversion.report.issues) {
    switch (issue.severity) {
      case 'info':
        issueCounts.info += 1;
        break;
      case 'warning':
        issueCounts.warning += 1;
        break;
      case 'blocking':
        issueCounts.blocking += 1;
        break;
    }
    if (!observedIssueCodes.has(issue.code)) {
      issueCodes.push(issue.code);
      observedIssueCodes.add(issue.code);
    }
  }

  return RecordingWorkflowDraftResponseSchema.parse({
    schemaVersion: 1,
    recordingSessionId: result.conversion.recordingSessionId,
    clientConversionId: result.conversion.clientConversionId,
    workflowId: result.conversion.workflowId,
    workflowVersionId: result.conversion.workflowVersionId,
    version: conversion.workflowDefinition.version,
    status: conversion.workflowDefinition.status,
    publishable: conversion.report.publishable,
    generatedStepCount: conversion.workflowDefinition.steps.length,
    generatedVariableCount: conversion.workflowDefinition.variables.length,
    deduplicatedEventCount: conversion.report.deduplicatedEventCount,
    unresolvedEventCount: conversion.report.unresolvedEvents.length,
    issueCounts,
    issueCodes,
    idempotent: result.idempotent,
  });
}
