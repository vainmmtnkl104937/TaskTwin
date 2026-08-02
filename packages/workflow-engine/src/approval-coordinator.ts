import type {
  ApprovalCoordinatorRequest,
  ApprovalCoordinatorResult,
} from '@tasktwin/workflow-approval';

export interface WorkflowApprovalCoordinator {
  awaitApproval(
    request: ApprovalCoordinatorRequest,
    signal: AbortSignal,
  ): Promise<ApprovalCoordinatorResult>;
}
