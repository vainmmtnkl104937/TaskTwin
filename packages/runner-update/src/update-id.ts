import { Sha256HexSchema } from '@tasktwin/runner-release';
import { z } from 'zod';

import { RUNNER_UPDATE_ID_PREFIX } from './constants.js';
import {
  RunnerUpdateIdSchema,
  RunnerUpdateOperationSchema,
  type RunnerUpdateId,
} from './contracts.js';
import { RunnerUpdateError } from './errors.js';

export const RunnerUpdateIdInputSchema = z.strictObject({
  operation: RunnerUpdateOperationSchema.exclude(['recover']),
  sourceManifestSha256: Sha256HexSchema,
  targetManifestSha256: Sha256HexSchema,
});

export interface RunnerUpdateHasher {
  sha256Hex(value: string): string;
}

export type RunnerUpdateIdInput = z.infer<typeof RunnerUpdateIdInputSchema>;

export function deriveRunnerUpdateId(
  rawInput: RunnerUpdateIdInput,
  hasher: RunnerUpdateHasher,
): RunnerUpdateId {
  const input = RunnerUpdateIdInputSchema.parse(rawInput);
  if (typeof hasher.sha256Hex !== 'function') {
    throw new RunnerUpdateError(
      'update_id_invalid',
      'Runner update ID hashing is unavailable.',
    );
  }

  const material = [
    'tasktwin-runner-update',
    'schema=1',
    `operation=${input.operation}`,
    `source=${input.sourceManifestSha256}`,
    `target=${input.targetManifestSha256}`,
  ].join('\n');
  const digest = Sha256HexSchema.safeParse(hasher.sha256Hex(material));
  if (!digest.success) {
    throw new RunnerUpdateError(
      'update_id_invalid',
      'Runner update ID hashing returned an invalid digest.',
    );
  }
  return RunnerUpdateIdSchema.parse(`${RUNNER_UPDATE_ID_PREFIX}${digest.data}`);
}
