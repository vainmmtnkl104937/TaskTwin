import { z } from 'zod';

export const AuditSystemReasonSchema = z.enum([
  'automatic_expiry',
  'completion_reconciliation',
  'lease_expired',
  'policy_supersede',
  'run_cancelled',
  'scheduler',
  'automatic',
]);

export const UserAuditActorSchema = z
  .object({
    type: z.literal('user'),
    userId: z.string().uuid(),
  })
  .strict();

export const RunnerAuditActorSchema = z
  .object({
    type: z.literal('runner'),
    runnerDeviceId: z.string().uuid(),
  })
  .strict();

export const SystemAuditActorSchema = z
  .object({
    type: z.literal('system'),
    reason: AuditSystemReasonSchema,
  })
  .strict();

export const AuditActorSchema = z.discriminatedUnion('type', [
  UserAuditActorSchema,
  RunnerAuditActorSchema,
  SystemAuditActorSchema,
]);

export type AuditActor = z.infer<typeof AuditActorSchema>;
export type AuditSystemReason = z.infer<typeof AuditSystemReasonSchema>;
