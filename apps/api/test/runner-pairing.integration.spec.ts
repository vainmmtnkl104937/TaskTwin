import { createHmac, randomUUID } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createDatabaseClient,
  getRequiredDatabaseUrl,
  OrganizationRole,
  type PrismaClient,
} from '@tasktwin/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/config/configure-application.js';
import { loadRootEnvironment } from '../src/config/environment.js';

const prefix = `session14-${randomUUID()}`;
const password = 'session-14-secure-test-password';
const pairingPepper = 'session-14-pairing-code-pepper-value';
const credentialPepper = 'session-14-credential-pepper-value';

interface RegisteredIdentity {
  user: { id: string };
  organization: { id: string };
  workspace: { id: string };
  accessToken: string;
}

interface PairingResponse {
  userCode: string;
  deviceCode: string;
  intervalSeconds: number;
}

describe('Local Runner pairing integration', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let owner: RegisteredIdentity;
  let admin: RegisteredIdentity;
  let member: RegisteredIdentity;
  let viewer: RegisteredIdentity;
  let outsider: RegisteredIdentity;

  beforeAll(async () => {
    loadRootEnvironment();
    process.env.RUNNER_PAIRING_CODE_PEPPER = pairingPepper;
    process.env.RUNNER_CREDENTIAL_PEPPER = credentialPepper;
    process.env.TASKTWIN_WEB_BASE_URL = 'http://127.0.0.1:3000';
    prisma = createDatabaseClient(getRequiredDatabaseUrl());
    await prisma.$connect();
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();

    owner = await register('owner');
    admin = await register('admin');
    member = await register('member');
    viewer = await register('viewer');
    outsider = await register('outsider');
    await prisma.organizationMember.createMany({
      data: [
        {
          userId: admin.user.id,
          organizationId: owner.organization.id,
          role: OrganizationRole.ADMIN,
        },
        {
          userId: member.user.id,
          organizationId: owner.organization.id,
          role: OrganizationRole.MEMBER,
        },
        {
          userId: viewer.user.id,
          organizationId: owner.organization.id,
          role: OrganizationRole.VIEWER,
        },
      ],
    });
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      await prisma.runnerCredential.deleteMany({
        where: {
          runnerDevice: {
            pairingSession: { displayName: { startsWith: prefix } },
          },
        },
      });
      await prisma.runnerDevice.deleteMany({
        where: { pairingSession: { displayName: { startsWith: prefix } } },
      });
      await prisma.runnerPairingSession.deleteMany({
        where: { displayName: { startsWith: prefix } },
      });
      // Software-version heartbeats append immutable workspace audit events.
      // Keep their registration graph, matching the audit integration suite,
      // rather than weakening the production immutability trigger for cleanup.
      await prisma.$disconnect();
    }
    await app?.close();
  });

  async function register(label: string): Promise<RegisteredIdentity> {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `${prefix}-${label}@example.test`,
        password,
        displayName: `${label} user`,
        organizationName: `${prefix}-${label}`,
      })
      .expect(201);
    return response.body as RegisteredIdentity;
  }

  async function createPairing(label: string): Promise<PairingResponse> {
    const response = await request(app.getHttpServer())
      .post('/runner-pairing/sessions')
      .send({
        schemaVersion: 1,
        metadata: {
          displayName: `${prefix}-${label}`,
          platform: 'win32',
          architecture: 'x64',
          runnerVersion: '0.1.0',
          installationId: randomUUID(),
        },
      })
      .expect(200);
    return response.body as PairingResponse;
  }

  it('pairs idempotently, authenticates heartbeat, lists, and revokes', async () => {
    const pairing = await createPairing('primary');
    const storedPairing = await prisma.runnerPairingSession.findFirstOrThrow({
      where: { displayName: `${prefix}-primary` },
    });
    expect(JSON.stringify(storedPairing)).not.toContain(pairing.userCode);
    expect(JSON.stringify(storedPairing)).not.toContain(pairing.deviceCode);
    expect(storedPairing.deviceCodeHash).toHaveLength(64);
    expect(storedPairing.userCodeDigest).toHaveLength(64);

    await request(app.getHttpServer())
      .post('/runner-pairing/inspect')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ schemaVersion: 1, userCode: pairing.userCode })
      .expect(200);

    for (const identity of [member, viewer]) {
      await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspace.id}/runner-pairing/approve`)
        .set('Authorization', `Bearer ${identity.accessToken}`)
        .send({ schemaVersion: 1, userCode: pairing.userCode })
        .expect(403);
    }
    await request(app.getHttpServer())
      .post(`/workspaces/${owner.workspace.id}/runner-pairing/approve`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ schemaVersion: 1, userCode: pairing.userCode })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/workspaces/${owner.workspace.id}/runner-pairing/approve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ schemaVersion: 1, userCode: pairing.userCode.toLowerCase() })
      .expect(200);

    await request(app.getHttpServer())
      .post('/runner-pairing/inspect')
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ schemaVersion: 1, userCode: pairing.userCode })
      .expect(404);

    const first = await request(app.getHttpServer())
      .post('/runner-pairing/token')
      .send({ schemaVersion: 1, deviceCode: pairing.deviceCode })
      .expect(200);
    expect(first.body.status).toBe('paired');
    const retry = await request(app.getHttpServer())
      .post('/runner-pairing/token')
      .send({ schemaVersion: 1, deviceCode: pairing.deviceCode })
      .expect(200);
    expect(retry.body).toEqual(first.body);

    const runnerDeviceId = first.body.runnerDeviceId as string;
    const credential = first.body.credential as string;
    expect(
      await prisma.runnerDevice.count({
        where: { pairingSessionId: storedPairing.id },
      }),
    ).toBe(1);
    const storedCredential = await prisma.runnerCredential.findFirstOrThrow({
      where: { runnerDeviceId },
    });
    expect(storedCredential.credentialHash).not.toBe(credential);
    expect(JSON.stringify(storedCredential)).not.toContain(credential);

    const runnerHeader = `TaskTwinRunner ${runnerDeviceId}.${credential}`;
    const runtime = {
      schemaVersion: 1,
      runtimeMode: 'service',
      autonomyLevel: 'boot_resilient',
      serviceStatus: 'running',
      secretUnlockMode: 'os_native',
      restartResilient: true,
    };
    const softwareIdentity = {
      product: 'tasktwin-runner',
      version: '0.1.1',
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      platform: 'windows',
      architecture: 'x64',
    };
    await request(app.getHttpServer())
      .post('/runner/heartbeat')
      .set('Authorization', runnerHeader)
      .send({
        schemaVersion: 1,
        runnerVersion: '0.1.1',
        softwareIdentity,
        capabilities: ['runner_service_v1', 'os_native_secret_unlock_v1'],
        runtime,
      })
      .expect('TaskTwin-Runner-Compatibility', 'compatible')
      .expect(200);
    const firstSoftwareMetadata = await prisma.runnerDevice.findUniqueOrThrow({
      where: { id: runnerDeviceId },
      select: {
        softwareMetadataRevision: true,
        softwareMetadataUpdatedAt: true,
      },
    });
    await request(app.getHttpServer())
      .post('/runner/heartbeat')
      .set('Authorization', runnerHeader)
      .send({
        schemaVersion: 1,
        runnerVersion: '0.1.1',
        softwareIdentity,
        capabilities: ['runner_service_v1', 'os_native_secret_unlock_v1'],
        runtime,
      })
      .expect('TaskTwin-Runner-Compatibility', 'compatible')
      .expect(200);
    const heartbeatDevice = await prisma.runnerDevice.findUniqueOrThrow({
      where: { id: runnerDeviceId },
      include: { credential: true },
    });
    expect(heartbeatDevice.lastSeenAt).not.toBeNull();
    expect(heartbeatDevice.credential?.lastUsedAt).not.toBeNull();
    expect(heartbeatDevice).toMatchObject({
      runtimeMode: 'service',
      autonomyLevel: 'boot_resilient',
      serviceStatus: 'running',
      secretUnlockMode: 'os_native',
      restartResilient: true,
      runtimeMetadataRevision: 1,
      runProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      softwareMetadataRevision: 1,
    });
    expect(heartbeatDevice.softwareMetadataUpdatedAt).not.toBeNull();
    expect(heartbeatDevice.softwareMetadataRevision).toBe(
      firstSoftwareMetadata.softwareMetadataRevision,
    );
    expect(heartbeatDevice.softwareMetadataUpdatedAt).toEqual(
      firstSoftwareMetadata.softwareMetadataUpdatedAt,
    );
    expect(
      await prisma.workspaceAuditEvent.count({
        where: {
          workspaceId: owner.workspace.id,
          eventType: 'runner.runtime_mode.changed',
        },
      }),
    ).toBe(1);
    const softwareVersionEvents = await prisma.workspaceAuditEvent.findMany({
      where: {
        workspaceId: owner.workspace.id,
        eventType: 'runner.software_version.changed',
      },
    });
    expect(softwareVersionEvents).toHaveLength(1);
    expect(softwareVersionEvents[0]?.payload).toEqual({
      runnerDeviceId,
      previousVersion: '0.1.0',
      newVersion: '0.1.1',
      runnerProtocolVersion: 2,
      localStateSchemaVersion: 1,
    });
    expect(
      await prisma.workspaceAuditEvent.count({
        where: {
          workspaceId: owner.workspace.id,
          eventType: 'runner.secret_protector.changed',
        },
      }),
    ).toBe(1);

    const list = await request(app.getHttpServer())
      .get(`/workspaces/${owner.workspace.id}/runner-devices`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(list.body.devices).toHaveLength(1);
    expect(list.body.devices[0].runtime).toMatchObject({
      runtimeMode: 'service',
      autonomyLevel: 'boot_resilient',
      secretUnlockMode: 'os_native',
      restartResilient: true,
    });
    expect(list.body.devices[0]).toMatchObject({
      softwareIdentity,
      compatibility: { status: 'compatible', reasons: [] },
    });
    expect(JSON.stringify(list.body)).not.toContain(credential);
    expect(JSON.stringify(list.body)).not.toContain('protectedKey');
    expect(JSON.stringify(list.body)).not.toContain('serviceAccount');

    await request(app.getHttpServer())
      .get(`/workspaces/${owner.workspace.id}/runner-devices`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/runner-devices/${runnerDeviceId}/revoke`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .post(`/runner-devices/${runnerDeviceId}/revoke`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post(`/runner-devices/${runnerDeviceId}/revoke`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .post('/runner/heartbeat')
      .set('Authorization', runnerHeader)
      .send({ schemaVersion: 1, runnerVersion: '0.1.1' })
      .expect(401);
  });

  it('enforces pending polling intervals with slow_down', async () => {
    const pairing = await createPairing('slow-down');
    const first = await request(app.getHttpServer())
      .post('/runner-pairing/token')
      .send({ schemaVersion: 1, deviceCode: pairing.deviceCode })
      .expect(200);
    expect(first.body.status).toBe('authorization_pending');
    const early = await request(app.getHttpServer())
      .post('/runner-pairing/token')
      .send({ schemaVersion: 1, deviceCode: pairing.deviceCode })
      .expect(200);
    expect(early.body).toMatchObject({
      status: 'slow_down',
      intervalSeconds: pairing.intervalSeconds + 5,
    });
  });

  it('never issues credentials for denied or expired sessions', async () => {
    const denied = await createPairing('denied');
    await request(app.getHttpServer())
      .post('/runner-pairing/deny')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        schemaVersion: 1,
        workspaceId: owner.workspace.id,
        userCode: denied.userCode,
      })
      .expect(200);
    const deniedPoll = await request(app.getHttpServer())
      .post('/runner-pairing/token')
      .send({ schemaVersion: 1, deviceCode: denied.deviceCode })
      .expect(200);
    expect(deniedPoll.body).toEqual({
      schemaVersion: 1,
      status: 'access_denied',
    });

    const expired = await createPairing('expired');
    const expiredDigest = createHmac('sha256', pairingPepper)
      .update('device-code:v1')
      .update('\0')
      .update(expired.deviceCode)
      .digest('hex');
    await prisma.runnerPairingSession.update({
      where: { deviceCodeHash: expiredDigest },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const expiredPoll = await request(app.getHttpServer())
      .post('/runner-pairing/token')
      .send({ schemaVersion: 1, deviceCode: expired.deviceCode })
      .expect(200);
    expect(expiredPoll.body).toEqual({
      schemaVersion: 1,
      status: 'expired',
    });
  });
});
