import type {
  RecoveryCoordinatorRequest,
  RecoveryCoordinatorResult,
} from '@tasktwin/workflow-recovery';

export interface WorkflowRecoveryCoordinator {
  awaitRepair(
    request: RecoveryCoordinatorRequest,
    signal: AbortSignal,
  ): Promise<RecoveryCoordinatorResult>;
}
