import { z } from 'zod';

import { RolloutStageDefinitionSchema } from '@tasktwin/runner-rollout';

export const CreateRunnerRolloutRequestSchema = z.strictObject({
  clientRolloutId: z.string().uuid(),
  targetReleaseId: z.string().uuid(),
  stages: z.array(RolloutStageDefinitionSchema).min(1).max(1_000),
});

export const StageNumberSchema = z.coerce.number().int().positive().max(10_000);

export const RunnerRolloutListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
});
