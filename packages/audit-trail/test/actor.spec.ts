import { describe, expect, it } from 'vitest';

import { AuditActorSchema } from '../src/index.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const RUNNER_ID = '00000000-0000-4000-8000-000000000002';

describe('audit actors', () => {
  it('accepts bounded user, runner and system actors', () => {
    expect(AuditActorSchema.parse({ type: 'user', userId: USER_ID })).toEqual({
      type: 'user',
      userId: USER_ID,
    });
    expect(
      AuditActorSchema.parse({ type: 'runner', runnerDeviceId: RUNNER_ID }),
    ).toEqual({ type: 'runner', runnerDeviceId: RUNNER_ID });
    expect(
      AuditActorSchema.parse({ type: 'system', reason: 'lease_expired' }),
    ).toEqual({ type: 'system', reason: 'lease_expired' });
  });

  it('rejects identity metadata and unexpected properties', () => {
    expect(
      AuditActorSchema.safeParse({
        type: 'user',
        userId: USER_ID,
        email: 'hidden@example.test',
      }).success,
    ).toBe(false);
    expect(
      AuditActorSchema.safeParse({
        type: 'runner',
        runnerDeviceId: RUNNER_ID,
        hostname: 'private-machine',
      }).success,
    ).toBe(false);
    expect(
      AuditActorSchema.safeParse({ type: 'system', reason: 'arbitrary' }).success,
    ).toBe(false);
  });
});
