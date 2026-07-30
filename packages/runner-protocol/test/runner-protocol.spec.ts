import { describe, expect, it } from 'vitest';

import {
  ControlPlaneOriginSchema,
  PairingPollingResponseSchema,
  RunnerDeviceMetadataSchema,
  StoredRunnerCredentialSchema,
  canTransitionPairingStatus,
  deriveRunnerConnectionStatus,
  parseRunnerAuthorizationHeader,
} from '../src/index.js';

const metadata = {
  displayName: 'Development Runner',
  platform: 'win32',
  architecture: 'x64',
  runnerVersion: '0.1.0',
  installationId: '32f7a31d-e6ab-476a-80bc-13b9be58df5f',
} as const;

describe('runner device metadata', () => {
  it('accepts the bounded allowlist', () => {
    expect(RunnerDeviceMetadataSchema.parse(metadata)).toEqual(metadata);
  });

  it('rejects malformed and unexpected metadata', () => {
    expect(
      RunnerDeviceMetadataSchema.safeParse({
        ...metadata,
        platform: 'freebsd',
      }).success,
    ).toBe(false);
    expect(
      RunnerDeviceMetadataSchema.safeParse({
        ...metadata,
        username: 'must-not-be-collected',
      }).success,
    ).toBe(false);
  });
});

describe('control plane origin and stored credentials', () => {
  it.each([
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'https://api.tasktwin.example',
  ])('accepts safe origin %s', (origin) => {
    expect(ControlPlaneOriginSchema.parse(origin)).toBe(origin);
  });

  it.each([
    'http://api.tasktwin.example',
    'https://api.tasktwin.example/path',
    'https://user:password@api.tasktwin.example',
  ])('rejects unsafe origin %s', (origin) => {
    expect(ControlPlaneOriginSchema.safeParse(origin).success).toBe(false);
  });

  it('rejects a stored credential that could disclose itself over plain HTTP', () => {
    expect(
      StoredRunnerCredentialSchema.safeParse({
        schemaVersion: 1,
        controlPlaneOrigin: 'http://api.tasktwin.example',
        runnerDeviceId: 'b9d35a01-e29a-4894-bc2c-ea9e6b81c889',
        workspaceId: '2a0c786a-3234-42f0-a3bd-b6d7d76dce1f',
        installationId: metadata.installationId,
        credential: 'A'.repeat(43),
        savedAt: '2026-07-30T12:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('pairing polling contracts', () => {
  it.each([
    { schemaVersion: 1, status: 'authorization_pending', intervalSeconds: 5 },
    { schemaVersion: 1, status: 'slow_down', intervalSeconds: 10 },
    { schemaVersion: 1, status: 'access_denied' },
    { schemaVersion: 1, status: 'expired' },
    {
      schemaVersion: 1,
      status: 'paired',
      runnerDeviceId: 'b9d35a01-e29a-4894-bc2c-ea9e6b81c889',
      workspaceId: '2a0c786a-3234-42f0-a3bd-b6d7d76dce1f',
      credential: 'A'.repeat(43),
      heartbeatIntervalSeconds: 30,
    },
  ])('accepts $status', (response) => {
    expect(PairingPollingResponseSchema.safeParse(response).success).toBe(true);
  });

  it('rejects unexpected properties', () => {
    expect(
      PairingPollingResponseSchema.safeParse({
        schemaVersion: 1,
        status: 'expired',
        credential: 'must-not-exist',
      }).success,
    ).toBe(false);
  });
});

describe('pairing state', () => {
  it.each([
    ['PENDING', 'APPROVED'],
    ['PENDING', 'DENIED'],
    ['PENDING', 'EXPIRED'],
    ['APPROVED', 'CONSUMED'],
    ['APPROVED', 'EXPIRED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransitionPairingStatus(from, to)).toBe(true);
  });

  it('rejects terminal and unsupported transitions', () => {
    expect(canTransitionPairingStatus('CONSUMED', 'APPROVED')).toBe(false);
    expect(canTransitionPairingStatus('DENIED', 'PENDING')).toBe(false);
    expect(canTransitionPairingStatus('PENDING', 'CONSUMED')).toBe(false);
  });
});

describe('runner authentication and connection status', () => {
  it('strictly parses the runner authorization scheme', () => {
    expect(
      parseRunnerAuthorizationHeader(
        `TaskTwinRunner b9d35a01-e29a-4894-bc2c-ea9e6b81c889.${'A'.repeat(43)}`,
      ),
    ).toEqual({
      runnerDeviceId: 'b9d35a01-e29a-4894-bc2c-ea9e6b81c889',
      credential: 'A'.repeat(43),
    });
    expect(
      parseRunnerAuthorizationHeader(`Bearer ${'A'.repeat(43)}`),
    ).toBeNull();
  });

  it('derives revoked, online, and offline without background state', () => {
    const now = '2026-07-30T10:00:00.000Z';
    expect(
      deriveRunnerConnectionStatus({
        now,
        lastSeenAt: '2026-07-30T09:59:30.000Z',
        revokedAt: null,
        offlineAfterSeconds: 90,
      }),
    ).toBe('online');
    expect(
      deriveRunnerConnectionStatus({
        now,
        lastSeenAt: '2026-07-30T09:50:00.000Z',
        revokedAt: null,
        offlineAfterSeconds: 90,
      }),
    ).toBe('offline');
    expect(
      deriveRunnerConnectionStatus({
        now,
        lastSeenAt: now,
        revokedAt: now,
        offlineAfterSeconds: 90,
      }),
    ).toBe('revoked');
  });
});
