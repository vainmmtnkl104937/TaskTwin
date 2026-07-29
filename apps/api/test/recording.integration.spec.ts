import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createDatabaseClient,
  getRequiredDatabaseUrl,
  OrganizationRole,
  type PrismaClient,
} from '@tasktwin/database';
import {
  RecordingEventSchema,
  RecordingPrivacySummarySchema,
  type RecordingEvent,
  type RecordingPrivacySummary,
} from '@tasktwin/recording-schema';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/config/configure-application.js';
import { loadRootEnvironment } from '../src/config/environment.js';

interface RegistrationBody {
  user: { id: string; email: string };
  organization: { id: string };
  workspace: { id: string; organizationId: string };
  accessToken: string;
}

interface CreatedRecordingBody {
  recordingSessionId: string;
  clientSessionId: string;
  idempotent: boolean;
}

const timestamp = '2026-07-29T10:00:00.000Z';

function createPrivacySummary(eventCount: number): RecordingPrivacySummary {
  return RecordingPrivacySummarySchema.parse({
    schemaVersion: 1,
    totalEvents: eventCount,
    policyCounts: { allow: eventCount, mask: 0, block: 0 },
    sensitivityCounts: {
      public: eventCount,
      general: 0,
      personal: 0,
      authentication: 0,
      financial: 0,
      identity: 0,
      health: 0,
      unknownSensitive: 0,
    },
  });
}

function createClickEvent(
  clientSessionId: string,
  sequence: number,
): RecordingEvent {
  const occurredAt = new Date(
    Date.parse(timestamp) + sequence * 1_000,
  ).toISOString();

  return RecordingEventSchema.parse({
    schemaVersion: 3,
    eventType: 'click',
    occurredAt,
    target: {
      tagName: 'button',
      inputType: null,
      role: 'button',
      id: null,
      name: null,
      labelText: null,
      accessibleName: 'Run fixture action',
      placeholder: null,
      textPreview: 'Run fixture action',
      testIdCandidates: [{ attribute: 'data-testid', value: 'fixture-action' }],
    },
    locatorBundle: {
      schemaVersion: 1,
      primary: {
        locator: {
          kind: 'testId',
          value: 'fixture-action',
          attribute: 'data-testid',
        },
        score: 100,
        matchCount: 1,
        unique: true,
        source: 'testId',
        reasons: [
          {
            code: 'STRONG_TEST_ID',
            message: 'Uses an allowlisted test identifier.',
          },
          {
            code: 'UNIQUE_MATCH',
            message: 'Matches exactly one element.',
          },
        ],
      },
      fallbacks: [],
      confidence: 'high',
      generatedAt: occurredAt,
    },
    privacyDecision: {
      schemaVersion: 1,
      sensitivity: 'public',
      policy: 'allow',
      confidence: 'high',
      matchedRules: ['PUBLIC_SEMANTIC_ELEMENT'],
      reasons: ['Element metadata describes a public interaction.'],
    },
    payload: { activation: 'primary' },
    eventId: crypto.randomUUID(),
    sessionId: clientSessionId,
    sequence,
    tabId: 42,
    origin: 'https://example.test',
    recordedAt: occurredAt,
  });
}

function createSessionRequest(clientSessionId: string, eventCount: number) {
  return {
    schemaVersion: 1,
    clientSessionId,
    targetOrigin: 'https://example.test',
    startedAt: timestamp,
    stoppedAt: new Date(
      Date.parse(timestamp) + Math.max(eventCount, 1) * 2_000,
    ).toISOString(),
    eventCount,
    lastSequence: eventCount,
    privacySummary: createPrivacySummary(eventCount),
  };
}

function createBatch(
  clientSessionId: string,
  clientBatchId: string,
  events: RecordingEvent[],
) {
  const firstEvent = events[0];
  const lastEvent = events.at(-1);
  if (firstEvent === undefined || lastEvent === undefined) {
    throw new Error('Integration batches must not be empty');
  }

  return {
    schemaVersion: 1,
    clientSessionId,
    clientBatchId,
    eventCount: events.length,
    firstSequence: firstEvent.sequence,
    lastSequence: lastEvent.sequence,
    events,
  };
}

describe('recording sync integration', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaClient | undefined;
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const workspaceIds: string[] = [];
  const recordingSessionIds: string[] = [];
  const suffix = crypto.randomUUID();
  const password = 'Session09 integration password';
  let owner: RegistrationBody;
  let outsider: RegistrationBody;
  let viewer: RegistrationBody;

  async function register(
    emailPrefix: string,
    displayName: string,
  ): Promise<RegistrationBody> {
    if (app === undefined) {
      throw new Error('Integration application was not initialized');
    }
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `${emailPrefix}-${suffix}@example.test`,
        password,
        displayName,
        organizationName: `${displayName} Organization`,
      })
      .expect(201);
    const registration = response.body as RegistrationBody;
    userIds.push(registration.user.id);
    organizationIds.push(registration.organization.id);
    workspaceIds.push(registration.workspace.id);
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

    owner = await register('session09-owner', 'Recording Owner');
    outsider = await register('session09-outsider', 'Outside Owner');
    viewer = await register('session09-viewer', 'Recording Viewer');

    await prisma.organizationMember.create({
      data: {
        userId: viewer.user.id,
        organizationId: owner.organization.id,
        role: OrganizationRole.VIEWER,
      },
    });
  });

  afterAll(async () => {
    try {
      if (prisma !== undefined) {
        if (recordingSessionIds.length > 0) {
          await prisma.recordingSession.deleteMany({
            where: { id: { in: recordingSessionIds } },
          });
        }
        if (organizationIds.length > 0) {
          await prisma.workspace.deleteMany({
            where: { organizationId: { in: organizationIds } },
          });
          await prisma.organization.deleteMany({
            where: { id: { in: organizationIds } },
          });
        }
        if (userIds.length > 0) {
          await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        }
        await prisma.$disconnect();
      }
    } finally {
      if (app !== undefined) {
        await app.close();
      }
    }
  });

  it('creates idempotently, ingests two batches, retries, completes, and returns safe metadata', async () => {
    if (app === undefined || prisma === undefined) {
      throw new Error('Integration application was not initialized');
    }

    const clientSessionId = crypto.randomUUID();
    const sessionRequest = createSessionRequest(clientSessionId, 4);
    const firstCreate = await request(app.getHttpServer())
      .post(`/workspaces/${owner.workspace.id}/recording-sessions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(sessionRequest)
      .expect(200);
    const created = firstCreate.body as CreatedRecordingBody;
    recordingSessionIds.push(created.recordingSessionId);
    expect(created).toMatchObject({
      clientSessionId,
      idempotent: false,
    });

    const repeatedCreate = await request(app.getHttpServer())
      .post(`/workspaces/${owner.workspace.id}/recording-sessions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(sessionRequest)
      .expect(200);
    expect(repeatedCreate.body).toMatchObject({
      recordingSessionId: created.recordingSessionId,
      idempotent: true,
    });

    const events = [1, 2, 3, 4].map((sequence) =>
      createClickEvent(clientSessionId, sequence),
    );
    const firstBatch = createBatch(
      clientSessionId,
      'session09-batch-1-2',
      events.slice(0, 2),
    );
    const secondBatch = createBatch(
      clientSessionId,
      'session09-batch-3-4',
      events.slice(2),
    );

    await request(app.getHttpServer())
      .post(`/recording-sessions/${created.recordingSessionId}/batches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(firstBatch)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/recording-sessions/${created.recordingSessionId}/batches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(secondBatch)
      .expect(200);

    const retry = await request(app.getHttpServer())
      .post(`/recording-sessions/${created.recordingSessionId}/batches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(firstBatch)
      .expect(200);
    expect(retry.body).toMatchObject({
      idempotent: true,
      receivedEventCount: 4,
    });
    await expect(
      prisma.recordingEvent.count({
        where: { recordingSessionId: created.recordingSessionId },
      }),
    ).resolves.toBe(4);

    await request(app.getHttpServer())
      .post(`/recording-sessions/${created.recordingSessionId}/complete`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        schemaVersion: 1,
        clientSessionId,
        eventCount: 4,
        lastSequence: 4,
        privacySummary: createPrivacySummary(4),
      })
      .expect(200);

    const metadata = await request(app.getHttpServer())
      .get(`/recording-sessions/${created.recordingSessionId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(metadata.body).toMatchObject({
      recordingSessionId: created.recordingSessionId,
      status: 'completed',
      eventCount: 4,
      receivedEventCount: 4,
    });
    expect(metadata.body).not.toHaveProperty('events');
    expect(JSON.stringify(metadata.body)).not.toContain('locatorBundle');
    expect(JSON.stringify(metadata.body)).not.toContain('payload');

    await request(app.getHttpServer())
      .post(`/recording-sessions/${created.recordingSessionId}/batches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(
        createBatch(clientSessionId, 'session09-new-after-complete', [
          events[0]!,
        ]),
      )
      .expect(409);

    await request(app.getHttpServer())
      .get(`/recording-sessions/${created.recordingSessionId}`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/recording-sessions/${created.recordingSessionId}`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/recording-sessions/${created.recordingSessionId}/batches`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .send(firstBatch)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/workspaces/${owner.workspace.id}/recording-sessions`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .send(createSessionRequest(crypto.randomUUID(), 0))
      .expect(403);
  });

  it('refuses completion when separate valid batches leave a sequence gap', async () => {
    if (app === undefined) {
      throw new Error('Integration application was not initialized');
    }

    const clientSessionId = crypto.randomUUID();
    const createResponse = await request(app.getHttpServer())
      .post(`/workspaces/${owner.workspace.id}/recording-sessions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(createSessionRequest(clientSessionId, 3))
      .expect(200);
    const created = createResponse.body as CreatedRecordingBody;
    recordingSessionIds.push(created.recordingSessionId);

    for (const sequence of [1, 3]) {
      await request(app.getHttpServer())
        .post(`/recording-sessions/${created.recordingSessionId}/batches`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send(
          createBatch(clientSessionId, `session09-gap-${sequence}`, [
            createClickEvent(clientSessionId, sequence),
          ]),
        )
        .expect(200);
    }

    await request(app.getHttpServer())
      .post(`/recording-sessions/${created.recordingSessionId}/complete`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        schemaVersion: 1,
        clientSessionId,
        eventCount: 3,
        lastSequence: 3,
        privacySummary: createPrivacySummary(3),
      })
      .expect(409);
  });

  it('rejects malformed and forged sensitive values before persistence', async () => {
    if (app === undefined || prisma === undefined) {
      throw new Error('Integration application was not initialized');
    }

    const clientSessionId = crypto.randomUUID();
    const createResponse = await request(app.getHttpServer())
      .post(`/workspaces/${owner.workspace.id}/recording-sessions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(createSessionRequest(clientSessionId, 1))
      .expect(200);
    const created = createResponse.body as CreatedRecordingBody;
    recordingSessionIds.push(created.recordingSessionId);

    const event = createClickEvent(clientSessionId, 1);
    const malformedSensitiveEvent = {
      ...event,
      eventType: 'text-input',
      target: { ...event.target, tagName: 'input', inputType: 'password' },
      privacyDecision: {
        schemaVersion: 1,
        sensitivity: 'authentication',
        policy: 'block',
        confidence: 'high',
        matchedRules: ['AUTH_PASSWORD_TYPE'],
        reasons: ['Deterministic authentication metadata rules matched.'],
      },
      payload: {
        capturePolicy: 'block',
        value: 'fake-session09-password',
      },
    };

    await request(app.getHttpServer())
      .post(`/recording-sessions/${created.recordingSessionId}/batches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        schemaVersion: 1,
        clientSessionId,
        clientBatchId: 'session09-sensitive-rejected',
        eventCount: 1,
        firstSequence: 1,
        lastSequence: 1,
        events: [malformedSensitiveEvent],
      })
      .expect(400);

    const forgedGeneralEvent = {
      ...event,
      eventType: 'text-input',
      target: { ...event.target, tagName: 'input', inputType: 'password' },
      privacyDecision: {
        schemaVersion: 1,
        sensitivity: 'general',
        policy: 'allow',
        confidence: 'medium',
        matchedRules: ['GENERAL_NO_SENSITIVE_SIGNAL'],
        reasons: ['No supported sensitive metadata rule matched.'],
      },
      payload: {
        capturePolicy: 'allow',
        value: 'arbitrary credential text',
        truncated: false,
      },
    };

    await request(app.getHttpServer())
      .post(`/recording-sessions/${created.recordingSessionId}/batches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        schemaVersion: 1,
        clientSessionId,
        clientBatchId: 'session09-forged-privacy-rejected',
        eventCount: 1,
        firstSequence: 1,
        lastSequence: 1,
        events: [forgedGeneralEvent],
      })
      .expect(400);

    await expect(
      prisma.recordingEvent.count({
        where: { recordingSessionId: created.recordingSessionId },
      }),
    ).resolves.toBe(0);
  });
});
