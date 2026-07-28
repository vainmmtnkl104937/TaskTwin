import { z } from 'zod';

export const RunStatusSchema = z.enum([
  'pending',
  'running',
  'waitingForApproval',
  'succeeded',
  'failed',
  'cancelled',
]);

export const RunStepStatusSchema = z.enum([
  'pending',
  'running',
  'waitingForApproval',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunStepStatus = z.infer<typeof RunStepStatusSchema>;
