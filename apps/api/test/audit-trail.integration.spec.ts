import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';

import {
  appendAuditEventTransactional,
  auditHasherForTrail,
  createDatabaseClient,
  getRequiredDatabaseUrl,
  OrganizationRole,
  type PrismaClient,
  WorkspaceAuditTrailRepository,
} from '@tasktwin/database';
import {
  AuditTrailError,
  verifyAuditEventChain,
} from '@tasktwin/audit-trail';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/config/configure-application.js';
import { loadRootEnvironment } from '../src/config/environment.js';

interface Registration {
  user: { id: string };
  organization: { id: string };
  workspace: { id: string };
  accessToken: string;
}

const suffix = randomUUID();
const userIds: string[] = [];
const organizationIds: string[] = [];

describe('audit trail integration', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaClient | undefined;
  let owner: Registration;
  let admin: Registration;
  let member: Registration;
  let viewer: Registration;
  let outsider: Registration;

  async function register(prefix: string): Promise<Registration> {
    if (app === undefined) {
      throw new Error('Integration application was not initialized.');
    }
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `${prefix}-${suffix}@example.test`,
        password: 'Session25 integration password',
        displayName: prefix,
        organizationName: `${prefix} organization`,
      })
      .expect(201);
    const registration = response.body as Registration;
    userIds.push(registration.user.id);
    organizationIds.push(registration.organization.id);
    return registration;
  }

  beforeAll(async () => {
    loadRootEnvironment();
    prisma = createDatabaseClient(getRequiredDatabaseUrl());
    await prisma.$connect();

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();

    owner = await register('session25-owner');
    admin = await register('session25-admin');
    member = await register('session25-member');
    viewer = await register('session25-viewer');
    outsider = await register('session25-outsider');

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
    try {
      if (prisma !== undefined) {
        await prisma.$disconnect();
      }
    } finally {
      await app?.close();
    }
  });

  it('authorizes readers, gates verify, and rejects malformed queries', async () => {
    if (app === undefined || prisma === undefined) {
      throw new Error('Integration application was not initialized.');
    }
    const server = app.getHttpServer();
    const auth = (registration: Registration) => ({
      Authorization: `Bearer ${registration.accessToken}`,
    });

    // Ensure chain head exists for the workspace
    const head = await prisma.workspaceAuditChainHead.findUnique({
      where: { workspaceId: owner.workspace.id },
    });
    expect(head).not.toBeNull();

    // Owners and viewers can list
    await request(server)
      .get(`/workspaces/${owner.workspace.id}/audit-events`)
      .set(auth(owner))
      .expect(200)
      .expect(({ body }) => {
        expect(body.access.role).toBe('OWNER');
        expect(body.access.canVerify).toBe(true);
      });
    await request(server)
      .get(`/workspaces/${owner.workspace.id}/audit-events`)
      .set(auth(viewer))
      .expect(200)
      .expect(({ body }) => {
        expect(body.access.role).toBe('VIEWER');
        expect(body.access.canVerify).toBe(false);
      });
    await request(server)
      .get(`/workspaces/${owner.workspace.id}/audit-events`)
      .set(auth(outsider))
      .expect(404);

    // Member and viewer are rejected from verify
    await request(server)
      .post(`/workspaces/${owner.workspace.id}/audit-trail/verify`)
      .set(auth(member))
      .send({ sampleLimit: 5 })
      .expect(403);
    await request(server)
      .post(`/workspaces/${owner.workspace.id}/audit-trail/verify`)
      .set(auth(viewer))
      .send({ sampleLimit: 5 })
      .expect(403);
    await request(server)
      .post(`/workspaces/${owner.workspace.id}/audit-trail/verify`)
      .set(auth(owner))
      .send({ sampleLimit: 5 })
      .expect(200);

    // Bad query bounds
    await request(server)
      .get(
        `/workspaces/${owner.workspace.id}/audit-events?eventTypes=${'workflow.created,'.repeat(25)}`,
      )
      .set(auth(owner))
      .expect(400);
    await request(server)
      .get(`/workspaces/${owner.workspace.id}/audit-events?limit=999`)
      .set(auth(owner))
      .expect(400);
    await request(server)
      .get(`/workspaces/${owner.workspace.id}/audit-events?cursor=not-base64`)
      .set(auth(owner))
      .expect(400);
  });

  it('verifies the chain end-to-end and detects in-memory tampering', async () => {
    if (app === undefined || prisma === undefined) {
      throw new Error('Integration application was not initialized.');
    }
    const repository = new WorkspaceAuditTrailRepository(prisma);

    // Append three events on the workspace chain
    const workspaceId = owner.workspace.id;
    for (let index = 0; index < 3; index += 1) {
      const eventType =
        index === 0
          ? 'workflow.created'
          : index === 1
            ? 'workflow_version.created'
            : 'workflow_draft.updated';
      await appendAuditEventTransactional(prisma, repository, {
        schemaVersion: 1,
        workspaceId,
        eventType,
        actor: { type: 'user', userId: owner.user.id },
        primaryEntity: { kind: 'workflow', id: `workflow-${suffix}-${index}` },
        relatedEntities:
          index === 1
            ? [{ kind: 'workflow_version', id: randomUUID() }]
            : [],
        occurredAt: new Date(
          Date.now() - (3 - index) * 60_000,
        ).toISOString(),
        sourceId: `session25-source-${suffix}-${index}`,
        payload:
          eventType === 'workflow.created'
            ? { workflowId: `workflow-${suffix}-${index}` }
            : eventType === 'workflow_version.created'
              ? {
                  workflowId: `workflow-${suffix}-${index}`,
                  workflowVersionId: randomUUID(),
                  version: 1,
                  revision: 1,
                  schemaVersion: 1,
                }
              : {
                  workflowId: `workflow-${suffix}-${index}`,
                  workflowVersionId: randomUUID(),
                  version: 1,
                  revision: 1,
                  stepCount: 2,
                },
      });
    }

    const head = await repository.getChainHead(workspaceId);
    const sample = await repository.readRangeForVerification(
      { workspaceId, sampleLimit: 10 },
      auditHasherForTrail,
    );

    // Happy path
    const happy = verifyAuditEventChain(auditHasherForTrail, sample.events, {
      storedHeadHash: head.lastEventHash,
    });
    expect(happy.valid).toBe(true);
    expect(happy.checkedCount).toBeGreaterThanOrEqual(3);

    // Tamper: mutate one event payload and re-verify
    if (sample.events.length > 0) {
      const tampered = [...sample.events];
      const first = tampered[0];
      if (first !== undefined) {
        tampered[0] = {
          ...first,
          payload: { workflowId: 'tampered-value' },
        };
      }
      const failed = verifyAuditEventChain(auditHasherForTrail, tampered, {
        storedHeadHash: head.lastEventHash,
      });
      expect(failed.valid).toBe(false);
      expect(failed.failureCode).toBe('PAYLOAD_DIGEST_MISMATCH');
    }

    // Sequence gap
    const gap = [...sample.events];
    if (gap[1] !== undefined) {
      gap[1] = { ...gap[1], sequence: gap[1].sequence + 2 };
    }
    const gapResult = verifyAuditEventChain(auditHasherForTrail, gap, {
      storedHeadHash: head.lastEventHash,
    });
    expect(gapResult.valid).toBe(false);
    expect(gapResult.failureCode).toBe('SEQUENCE_GAP');

    // Source conflict
    await expect(
      appendAuditEventTransactional(prisma, repository, {
        schemaVersion: 1,
        workspaceId,
        eventType: 'workflow_version.created',
        actor: { type: 'user', userId: owner.user.id },
        primaryEntity: {
          kind: 'workflow',
          id: `workflow-${suffix}-0`,
        },
        relatedEntities: [],
        occurredAt: new Date().toISOString(),
        sourceId: `session25-source-${suffix}-0`,
        payload: {
          workflowId: 'different',
          workflowVersionId: randomUUID(),
          version: 9,
          revision: 9,
          schemaVersion: 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'AUDIT_SOURCE_CONFLICT' } satisfies Partial<AuditTrailError>);
  });

  it('serves run evidence for a workflow run created via the API', async () => {
    if (app === undefined || prisma === undefined) {
      throw new Error('Integration application was not initialized.');
    }
    const repository = new WorkspaceAuditTrailRepository(prisma);

    // Create a workflow + published version so we can claim a run later.
    const workflowId = `session25-evidence-${suffix}`;
    const workflow = await prisma.workflow.create({
      data: {
        id: workflowId,
        workspaceId: owner.workspace.id,
        name: 'Session 25 evidence fixture',
        versions: {
          create: {
            version: 1,
            status: 'published',
            schemaVersion: 1,
            definition: {
              schemaVersion: 1,
              workflowId,
              version: 1,
              name: 'Session 25 evidence',
              status: 'published',
              variables: [],
              steps: [
                {
                  id: 'wait',
                  type: 'wait',
                  name: 'Wait',
                  durationMs: 5,
                },
              ],
            },
            publishedAt: new Date(),
            publishedById: owner.user.id,
          },
        },
      },
      select: { versions: { select: { id: true } } },
    });
    const versionId = workflow.versions[0]!.id;

    // Append a workflow_run.created audit event for the run.
    const workflowRunId = randomUUID();
    const created = await appendAuditEventTransactional(
      prisma,
      repository,
      {
        schemaVersion: 1,
        workspaceId: owner.workspace.id,
        eventType: 'workflow_run.created',
        actor: { type: 'user', userId: owner.user.id },
        primaryEntity: { kind: 'workflow_run', id: workflowRunId },
        relatedEntities: [
          { kind: 'workflow', id: workflowId },
          { kind: 'workflow_version', id: versionId },
        ],
        occurredAt: new Date().toISOString(),
        sourceId: `session25-evidence-created-${suffix}`,
        payload: {
          workflowRunId,
          workflowId,
          workflowVersionId: versionId,
          runnerDeviceId: randomUUID(),
          workflowDigest: 'a'.repeat(64),
          policyVersionId: randomUUID(),
          policyDigest: 'b'.repeat(64),
        },
      },
    );

    expect(created.idempotent).toBe(false);

    // Fetch evidence
    const response = await request(app.getHttpServer())
      .get(`/workflow-runs/${workflowRunId}/evidence`)
      .set({ Authorization: `Bearer ${owner.accessToken}` })
      .expect(200);

    expect(response.body.workflowRunId).toBe(workflowRunId);
    expect(response.body.events.length).toBeGreaterThan(0);
    expect(response.body.events[0].eventType).toBe('workflow_run.created');
    expect(JSON.stringify(response.body)).not.toContain('secret');
    expect(JSON.stringify(response.body)).not.toContain('password');

    // Cross-org
    await request(app.getHttpServer())
      .get(`/workflow-runs/${workflowRunId}/evidence`)
      .set({ Authorization: `Bearer ${outsider.accessToken}` })
      .expect(404);

    void createHash;
  });
});