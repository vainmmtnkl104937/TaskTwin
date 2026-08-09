import { describe, expect, it } from 'vitest';

import {
  RunnerUpdateMaintenanceSnapshotSchema,
  maintenanceBlocksClaims,
  maintenanceIsDraining,
} from './update-maintenance.js';

describe('Runner update maintenance contract', () => {
  it('blocks claims in every non-inactive update state', () => {
    expect(maintenanceBlocksClaims({ state: 'inactive' })).toBe(false);
    for (const state of [
      'draining',
      'starting_target',
      'verifying_target',
      'rolling_back',
      'manual_recovery_required',
    ] as const) {
      expect(maintenanceBlocksClaims({ state })).toBe(true);
    }
    expect(maintenanceIsDraining({ state: 'draining' })).toBe(true);
    expect(maintenanceIsDraining({ state: 'verifying_target' })).toBe(false);
  });

  it('rejects credentials, paths, and unknown maintenance states', () => {
    expect(
      RunnerUpdateMaintenanceSnapshotSchema.safeParse({
        state: 'draining',
        credential: 'forbidden',
      }).success,
    ).toBe(false);
    expect(
      RunnerUpdateMaintenanceSnapshotSchema.safeParse({ state: 'forced' })
        .success,
    ).toBe(false);
  });
});
