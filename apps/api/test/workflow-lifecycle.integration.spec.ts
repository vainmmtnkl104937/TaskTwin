import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createDatabaseClient,
  getRequiredDatabaseUrl,
  OrganizationRole,
  type PrismaClient,
} from '@tasktwin/database';
import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
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

function definition(
  workflowId: string,
  version: number,
  status: 'draft' | 'published',
): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId,
    version,
    name: `Lifecycle version ${version}`,
    description: 'Session 13 integration workflow',
    status,
    variables: [
      {
        name: 'customerEmail',
        valueType: 'string',
        required: true,
      },
    ],
    steps: [
      {
        id: 'step-fill',
        type: 'fill',
        name: 'Fill customer email',
        locator: { kind: 'label', value: 'Email' },
        value: { kind: 'variable', variableName: 'customerEmail' },
      },
      {
        id: 'step-wait',
        type: 'wait',
        name: 'Wait',
        durationMs: 100,
      },
    ],
  };
}

describe('workflow lifecycle integration', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaClient | undefined;
  let owner: Registration;
  let member: Registration;
  let admin: Registration;
  let viewer: Registration;
  let outsider: Registration;
  const suffix = crypto.randomUUID();
  const workflowId = `workflow-session13-${suffix}`;
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const password = 'Session13 integration password';
  let publishedVersionId: string;
  let draftVersionId: string;

  async function register(prefix: string): Promise<Registration> {
    if (app === undefined) {
      throw new Error('Integration application was not initialized.');
    }
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `${prefix}-${suffix}@example.test`,
        password,
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

    owner = await register('session13-owner');
    member = await register('session13-member');
    admin = await register('session13-admin');
    viewer = await register('session13-viewer');
    outsider = await register('session13-outsider');
    await prisma.organizationMember.createMany({
      data: [
        {
          userId: member.user.id,
          organizationId: owner.organization.id,
          role: OrganizationRole.MEMBER,
        },
        {
          userId: admin.user.id,
          organizationId: owner.organization.id,
          role: OrganizationRole.ADMIN,
        },
        {
          userId: viewer.user.id,
          organizationId: owner.organization.id,
          role: OrganizationRole.VIEWER,
        },
      ],
    });

    const published = definition(workflowId, 1, 'published');
    const draft = definition(workflowId, 2, 'draft');
    const created = await prisma.workflow.create({
      data: {
        id: workflowId,
        workspaceId: owner.workspace.id,
        name: draft.name,
        description: draft.description,
        versions: {
          create: [
            {
              version: 1,
              status: 'published',
              schemaVersion: 1,
              definition: published,
              publishedAt: new Date('2026-07-30T10:00:00.000Z'),
              publishedById: owner.user.id,
            },
            {
              version: 2,
              status: 'draft',
              schemaVersion: 1,
              definition: draft,
            },
          ],
        },
      },
      select: {
        versions: {
          orderBy: { version: 'asc' },
          select: { id: true },
        },
      },
    });
    publishedVersionId = created.versions[0]!.id;
    draftVersionId = created.versions[1]!.id;
  });

  afterAll(async () => {
    try {
      if (prisma !== undefined) {
        await prisma.workflowVersion.deleteMany({ where: { workflowId } });
        await prisma.workflow.deleteMany({ where: { id: workflowId } });
        await prisma.organizationMember.deleteMany({
          where: {
            organizationId: owner?.organization.id,
            userId: { in: [member?.user.id, admin?.user.id, viewer?.user.id] },
          },
        });
        await prisma.workspace.deleteMany({
          where: { organizationId: { in: organizationIds } },
        });
        await prisma.organization.deleteMany({
          where: { id: { in: organizationIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await prisma.$disconnect();
      }
    } finally {
      await app?.close();
    }
  });

  it('enforces immutable lifecycle, authorization, idempotency and concurrency', async () => {
    if (app === undefined || prisma === undefined) {
      throw new Error('Integration application was not initialized.');
    }
    const server = app.getHttpServer();
    const auth = (registration: Registration) => ({
      Authorization: `Bearer ${registration.accessToken}`,
    });

    await request(server)
      .post(`/workflow-versions/${draftVersionId}/submit-for-testing`)
      .set(auth(member))
      .send({ expectedRevision: 1 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.workflowVersion.status).toBe('testing');
        expect(body.publishReadiness.ready).toBe(true);
      });

    await request(server)
      .get(`/workflow-versions/${draftVersionId}`)
      .set(auth(member))
      .expect(200)
      .expect(({ body }) => {
        expect(body.access.canEdit).toBe(false);
      });

    await request(server)
      .post(`/workflow-versions/${draftVersionId}/return-to-draft`)
      .set(auth(member))
      .send({ expectedRevision: 99 })
      .expect(409);
    await request(server)
      .post(`/workflow-versions/${draftVersionId}/return-to-draft`)
      .set(auth(member))
      .send({ expectedRevision: 1 })
      .expect(200);

    const edited = {
      ...definition(workflowId, 2, 'draft'),
      name: 'Edited lifecycle candidate',
    };
    await request(server)
      .patch(`/workflow-versions/${draftVersionId}/draft`)
      .set(auth(member))
      .send({ expectedRevision: 1, definition: edited })
      .expect(200)
      .expect(({ body }) => {
        expect(body.workflowVersion.revision).toBe(2);
      });
    await request(server)
      .post(`/workflow-versions/${draftVersionId}/submit-for-testing`)
      .set(auth(member))
      .send({ expectedRevision: 2 })
      .expect(200);

    await prisma.workflowVersion.update({
      where: { id: draftVersionId },
      data: { definition: { ...edited, steps: [] } },
    });
    await request(server)
      .post(`/workflow-versions/${draftVersionId}/publish`)
      .set(auth(admin))
      .send({ expectedRevision: 2 })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('WORKFLOW_PUBLISH_READINESS_BLOCKED');
      });
    await prisma.workflowVersion.update({
      where: { id: draftVersionId },
      data: { definition: edited },
    });

    await request(server)
      .post(`/workflow-versions/${draftVersionId}/publish`)
      .set(auth(member))
      .send({ expectedRevision: 2 })
      .expect(403);

    const beforePublish = await prisma.workflowVersion.findUniqueOrThrow({
      where: { id: draftVersionId },
      select: { definition: true, revision: true },
    });
    await request(server)
      .post(`/workflow-versions/${draftVersionId}/publish`)
      .set(auth(admin))
      .send({ expectedRevision: 2 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.workflowVersion.status).toBe('published');
        expect(body.workflowVersion.revision).toBe(2);
      });
    const afterPublish = await prisma.workflowVersion.findUniqueOrThrow({
      where: { id: draftVersionId },
      select: { definition: true, revision: true },
    });
    expect(afterPublish).toEqual(beforePublish);

    const firstPublished = await prisma.workflowVersion.findUniqueOrThrow({
      where: { id: publishedVersionId },
      select: { status: true, archivedAt: true, archivedById: true },
    });
    expect(firstPublished).toMatchObject({
      status: 'archived',
      archivedById: admin.user.id,
    });
    expect(firstPublished.archivedAt).toBeInstanceOf(Date);
    expect(
      await prisma.workflowVersion.count({
        where: { workflowId, status: 'published' },
      }),
    ).toBe(1);

    await request(server)
      .patch(`/workflow-versions/${draftVersionId}/draft`)
      .set(auth(owner))
      .send({ expectedRevision: 2, definition: edited })
      .expect(409);

    const clientCreationId = crypto.randomUUID();
    const creation = await request(server)
      .post(`/workflows/${workflowId}/versions`)
      .set(auth(member))
      .send({ sourceVersionId: draftVersionId, clientCreationId })
      .expect(200);
    const newDraftId = creation.body.workflowVersion.id as string;
    expect(creation.body).toMatchObject({
      idempotent: false,
      workflowVersion: {
        version: 3,
        revision: 1,
        status: 'draft',
        createdFromVersionId: draftVersionId,
      },
    });
    expect(creation.body.workflowVersion.definition.steps).toEqual(
      edited.steps,
    );
    expect(creation.body.workflowVersion.definition.variables).toEqual(
      edited.variables,
    );

    await request(server)
      .post(`/workflows/${workflowId}/versions`)
      .set(auth(member))
      .send({ sourceVersionId: draftVersionId, clientCreationId })
      .expect(200)
      .expect(({ body }) => {
        expect(body.idempotent).toBe(true);
        expect(body.workflowVersion.id).toBe(newDraftId);
      });

    await request(server)
      .post(`/workflows/${workflowId}/versions`)
      .set(auth(member))
      .send({
        sourceVersionId: newDraftId,
        clientCreationId: crypto.randomUUID(),
      })
      .expect(409);
    await request(server)
      .post(`/workflow-versions/${newDraftId}/submit-for-testing`)
      .set(auth(viewer))
      .send({ expectedRevision: 1 })
      .expect(403);
    await request(server)
      .post(`/workflow-versions/${newDraftId}/submit-for-testing`)
      .set(auth(outsider))
      .send({ expectedRevision: 1 })
      .expect(404);
    await request(server)
      .post(`/workflow-versions/${newDraftId}/submit-for-testing`)
      .set(auth(member))
      .send({ expectedRevision: 2 })
      .expect(409);

    const concurrentCreations = await Promise.all(
      [crypto.randomUUID(), crypto.randomUUID()].map((concurrentId) =>
        request(server)
          .post(`/workflows/${workflowId}/versions`)
          .set(auth(member))
          .send({
            sourceVersionId: draftVersionId,
            clientCreationId: concurrentId,
          }),
      ),
    );
    expect(concurrentCreations.map((response) => response.status)).toEqual([
      200, 200,
    ]);
    const concurrentVersions = concurrentCreations.map(
      (response) => response.body.workflowVersion.version as number,
    );
    expect(new Set(concurrentVersions).size).toBe(2);

    const concurrentVersionIds = concurrentCreations.map(
      (response) => response.body.workflowVersion.id as string,
    );
    await Promise.all(
      concurrentVersionIds.map((id) =>
        request(server)
          .post(`/workflow-versions/${id}/submit-for-testing`)
          .set(auth(member))
          .send({ expectedRevision: 1 })
          .expect(200),
      ),
    );
    const concurrentPublishes = await Promise.all(
      concurrentVersionIds.map((id) =>
        request(server)
          .post(`/workflow-versions/${id}/publish`)
          .set(auth(owner))
          .send({ expectedRevision: 1 }),
      ),
    );
    expect(
      concurrentPublishes.every((response) =>
        [200, 503].includes(response.status),
      ),
    ).toBe(true);
    expect(
      await prisma.workflowVersion.count({
        where: { workflowId, status: 'published' },
      }),
    ).toBe(1);

    const history = await request(server)
      .get(`/workflows/${workflowId}/versions`)
      .set(auth(viewer))
      .expect(200);
    expect(history.body.access).toEqual({
      role: 'VIEWER',
      canEdit: false,
      canPublish: false,
    });
    expect(history.body.versions.length).toBeGreaterThanOrEqual(5);
    expect(
      history.body.versions.some(
        (version: { id: string }) => version.id === publishedVersionId,
      ),
    ).toBe(true);
  });
});
