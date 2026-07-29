import type { RecordingConversionReport } from '@tasktwin/recording-converter';
import type { WorkflowDefinition } from '@tasktwin/workflow-schema';

export interface RecordingWorkflowConversionRecord {
  id: string;
  recordingSessionId: string;
  clientConversionId: string;
  workflowId: string;
  workflowVersionId: string;
  createdById: string;
  report: RecordingConversionReport;
  workflowDefinition: WorkflowDefinition;
  createdAt: Date;
}

export interface CreateRecordingWorkflowConversionResult {
  conversion: RecordingWorkflowConversionRecord;
  idempotent: boolean;
}
