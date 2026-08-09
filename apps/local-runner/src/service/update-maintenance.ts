import {
  RunnerActivationIdSchema,
  RunnerUpdateIdSchema,
} from '@tasktwin/runner-update';
import { z } from 'zod';

export const RunnerUpdateMaintenanceStateSchema = z.enum([
  'inactive',
  'draining',
  'starting_target',
  'verifying_target',
  'rolling_back',
  'manual_recovery_required',
]);

export const RunnerUpdateMaintenanceSnapshotSchema = z.strictObject({
  state: RunnerUpdateMaintenanceStateSchema,
  updateId: RunnerUpdateIdSchema.optional(),
  activationId: RunnerActivationIdSchema.optional(),
});

export type RunnerUpdateMaintenanceSnapshot = z.infer<
  typeof RunnerUpdateMaintenanceSnapshotSchema
>;

export interface RunnerUpdateMaintenanceSource {
  current(): Promise<RunnerUpdateMaintenanceSnapshot>;
  waitForChange(
    signal: AbortSignal,
    timeoutMilliseconds: number,
  ): Promise<void>;
}

export function maintenanceBlocksClaims(
  snapshot: RunnerUpdateMaintenanceSnapshot,
): boolean {
  return snapshot.state !== 'inactive';
}

export function maintenanceIsDraining(
  snapshot: RunnerUpdateMaintenanceSnapshot,
): boolean {
  return snapshot.state === 'draining';
}
