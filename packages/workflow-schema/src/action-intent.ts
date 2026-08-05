import { z } from 'zod';

export const WorkflowActionIntentSchema = z.enum([
  'read',
  'navigate',
  'enter_data',
  'change_state',
  'submit',
  'send',
  'delete',
  'purchase',
  'permission_change',
  'approval_gate',
  'unknown',
]);

export const ClickActionIntentSchema = z.enum([
  'change_state',
  'submit',
  'send',
  'delete',
  'purchase',
  'permission_change',
  'unknown',
]);

export type WorkflowActionIntent = z.infer<
  typeof WorkflowActionIntentSchema
>;
export type ClickActionIntent = z.infer<typeof ClickActionIntentSchema>;
