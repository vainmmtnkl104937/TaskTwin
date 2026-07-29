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

function workflowDefinition(
  workflowId: string,
  name: string,
  status: 'draft' | 'published' = 'draft',
): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId,
    version: 1,
    name,
    description: `${name} description`,
    status,
    variables: [],
    steps: [
      {
        id: 'step-wait',
        type: 'wait',
        name: 'Wait',
        durationMs: 500,
      },
      {
        id: 'step-checked',
        type: 'setChecked',
        name: 'Set option',
        locator: { kind: 'testId', value: 'safe-option' },
        checked: false,
      },
    ],
  };
}

describe('draft workflow editor integration', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaClient | undefined;
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const workflowIds: string[] = [];
  const suffix = crypto.randomUUID();
  const password = 'Session11 integration password';
  let owner: Registration;
  let outsider: Registration;
  let viewer: Registration;
  let draftWorkflowId: string;
  let draftVersionId: string;
  let publishedVersionId: string;

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

    owner = await register('session11-owner');
    outsider = await register('session11-outsider');
    viewer = await register('session11-viewer');
    await prisma.organizationMember.create({
      data: {
        userId: viewer.user.id,
        organizationId: owner.organization.id,
        role: OrganizationRole.VIEWER,
      },
    });

    draftWorkflowId = `workflow-session11-${suffix}`;
    const publishedWorkflowId = `workflow-session11-published-${suffix}`;
    workflowIds.push(draftWorkflowId, publishedWorkflowId);
    const draft = workflowDefinition(
      draftWorkflowId,
      'Session 11 draft workflow',
    );
    const published = workflowDefinition(
      publishedWorkflowId,
      'Session 11 published workflow',
      'published',
    );
    const createdDraft = await prisma.workflow.create({
      data: {
        id: draftWorkflowId,
        workspaceId: owner.workspace.id,
        name: draft.name,
        description: draft.description,
        versions: {
          create: {
            version: 1,
            status: 'draft',
            schemaVersion: 1,
            definition: draft,
          },
        },
      },
      select: { versions: { select: { id: true } } },
    });
    const createdPublished = await prisma.workflow.create({
      data: {
        id: publishedWorkflowId,
        workspaceId: owner.workspace.id,
        name: published.name,
        description: published.description,
        versions: {
          create: {
            version: 1,
            status: 'published',
            schemaVersion: 1,
            definition: published,
          },
        },
      },
      select: { versions: { select: { id: true } } },
    });
    draftVersionId = createdDraft.versions[0]!.id;
    publishedVersionId = createdPublished.versions[0]!.id;
  });

  afterAll(async () => {
    try {
      if (prisma !== undefined) {
        await prisma.workflowVersion.deleteMany({
          where: { workflowId: { in: workflowIds } },
        });
        await prisma.workflow.deleteMany({
          where: { id: { in: workflowIds } },
        });
        await prisma.organizationMember.deleteMany({
          where: {
            userId: viewer?.user.id,
            organizationId: owner?.organization.id,
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

  it('lists, reads, updates and protects draft workflow versions', async () => {
    if (app === undefined || prisma === undefined) {
      throw new Error('Integration application was not initialized.');
    }

    const list = await request(app.getHttpServer())
      .get(`/workspaces/${owner.workspace.id}/workflows`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(list.body.workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: draftWorkflowId,
          latestVersionId: draftVersionId,
          revision: 1,
        }),
      ]),
    );
    expect(JSON.stringify(list.body)).not.toContain('"definition"');

    await request(app.getHttpServer())
      .get(`/workspaces/${owner.workspace.id}/workflows`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/workflow-versions/${draftVersionId}`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.access).toEqual({ role: 'VIEWER', canEdit: false });
      });

    const original = workflowDefinition(
      draftWorkflowId,
      'Session 11 draft workflow',
    );
    const firstUpdate = {
      ...original,
      name: 'Session 11 updated draft',
      description: 'Synchronized Session 11 metadata',
      steps: [{ ...original.steps[0]!, durationMs: 750 }, original.steps[1]!],
    };
    await request(app.getHttpServer())
      .patch(`/workflow-versions/${draftVersionId}/draft`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ expectedRevision: 1, definition: firstUpdate })
      .expect(200)
      .expect(({ body }) => {
        expect(body.workflowVersion.revision).toBe(2);
        expect(body.workflowVersion.definition.name).toBe(firstUpdate.name);
      });

    const synchronized = await prisma.workflow.findUniqueOrThrow({
      where: { id: draftWorkflowId },
      select: {
        name: true,
        description: true,
        versions: {
          where: { id: draftVersionId },
          select: { revision: true, definition: true },
        },
      },
    });
    expect(synchronized).toMatchObject({
      name: firstUpdate.name,
      description: firstUpdate.description,
      versions: [{ revision: 2 }],
    });

    await request(app.getHttpServer())
      .patch(`/workflow-versions/${draftVersionId}/draft`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        expectedRevision: 1,
        definition: { ...firstUpdate, name: 'Stale overwrite' },
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('WORKFLOW_DRAFT_REVISION_CONFLICT');
        expect(body.currentRevision).toBe(2);
      });
    expect(
      (
        await prisma.workflow.findUniqueOrThrow({
          where: { id: draftWorkflowId },
          select: { name: true },
        })
      ).name,
    ).toBe(firstUpdate.name);

    const concurrentNames = ['Concurrent A', 'Concurrent B'];
    const concurrentResponses = await Promise.all(
      concurrentNames.map((name) =>
        request(app!.getHttpServer())
          .patch(`/workflow-versions/${draftVersionId}/draft`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            expectedRevision: 2,
            definition: { ...firstUpdate, name },
          }),
      ),
    );
    expect(
      concurrentResponses.map((response) => response.status).sort(),
    ).toEqual([200, 409]);
    const winner = concurrentResponses.find(
      (response) => response.status === 200,
    );
    const final = await prisma.workflow.findUniqueOrThrow({
      where: { id: draftWorkflowId },
      select: {
        name: true,
        versions: {
          where: { id: draftVersionId },
          select: { revision: true },
        },
      },
    });
    expect(final).toEqual({
      name: winner?.body.workflowVersion.definition.name,
      versions: [{ revision: 3 }],
    });

    await request(app.getHttpServer())
      .patch(`/workflow-versions/${draftVersionId}/draft`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .send({ expectedRevision: 3, definition: firstUpdate })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/workflow-versions/${draftVersionId}`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/workflow-versions/${publishedVersionId}/draft`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        expectedRevision: 1,
        definition: workflowDefinition(
          workflowIds[1]!,
          'Published mutation',
          'draft',
        ),
      })
      .expect(409);
  });
});
