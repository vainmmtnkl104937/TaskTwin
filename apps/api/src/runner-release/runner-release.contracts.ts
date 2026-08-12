import { z } from 'zod';

import {
  ReleaseManifestSchema,
  ReleaseSignatureSchema,
} from '@tasktwin/runner-release';
import { RunnerReleaseStatusReasonSchema } from '@tasktwin/runner-rollout';

export const ImportRunnerReleaseRequestSchema = z.strictObject({
  manifest: ReleaseManifestSchema,
  signature: ReleaseSignatureSchema,
});

export const ChangeRunnerReleaseStatusRequestSchema = z.strictObject({
  reasonCode: RunnerReleaseStatusReasonSchema,
});

export const RunnerReleaseListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
});
