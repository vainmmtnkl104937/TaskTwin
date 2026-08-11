import {
  ReleaseAcquisitionStateSchema,
  type ReleaseAcquisitionState,
} from './contracts.js';
import { RunnerAcquisitionError } from './errors.js';

const transitions: Readonly<
  Record<ReleaseAcquisitionState, readonly ReleaseAcquisitionState[]>
> = {
  idle: ['metadata_verified', 'failed'],
  metadata_verified: ['downloading', 'verified', 'failed'],
  downloading: ['partial', 'verified', 'failed'],
  partial: ['downloading', 'failed'],
  verified: [],
  failed: [],
};

export function assertReleaseAcquisitionTransition(
  from: ReleaseAcquisitionState,
  to: ReleaseAcquisitionState,
): void {
  const current = ReleaseAcquisitionStateSchema.parse(from);
  const next = ReleaseAcquisitionStateSchema.parse(to);
  if (!transitions[current].includes(next)) {
    throw new RunnerAcquisitionError(
      'acquisition_input_invalid',
      `Release acquisition cannot transition from ${current} to ${next}.`,
    );
  }
}
