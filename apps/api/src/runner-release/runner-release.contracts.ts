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
