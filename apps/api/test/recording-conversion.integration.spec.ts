import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createDatabaseClient,
  getRequiredDatabaseUrl,
  OrganizationRole,
  type PrismaClient,
} from '@tasktwin/database';
import { RecordingConversionReportSchema } from '@tasktwin/recording-converter';
import {
  createRecordingPrivacySummary,
  RecordingArtifactSchema,
  RecordingEventSchema,
  type RecordingArtifact,
  type RecordingEvent,
} from '@tasktwin/recording-schema';
import validRecordingArtifact from '@tasktwin/recording-schema/fixtures/valid-recording-artifact.v1.json' with { type: 'json' };
import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/config/configure-application.js';
import { loadRootEnvironment } from '../src/config/environment.js';

interface RegistrationBody {
  user: { id: string };
  organization: { id: string };
  workspace: { id: string };
  accessToken: string;
  email: string;
}

interface WorkflowDraftBody {
  recordingSessionId: string;
  clientConversionId: string;
  workflowId: string;
  workflowVersionId: string;
  version: number;
  status: string;
  publishable: boolean;
  generatedStepCount: number;
  unresolvedEventCount: number;
  idempotent: boolean;
}

const artifact = RecordingArtifactSchema.parse(validRecordingArtifact);

function fixtureEventId(sequence: number): string {
  return `10101010-1010-4010-8010-${String(sequence).padStart(12, '0')}`;
}

function withSequence(event: RecordingEvent, sequence: number): RecordingEvent {
  return RecordingEventSchema.parse({
    ...event,
    eventId: fixtureEventId(sequence),
    sequence,
    occurredAt: `2026-07-29T10:00:${String(sequence).padStart(2, '0')}.000Z`,
    recordedAt: `2026-07-29T10:00:${String(sequence).padStart(2, '0')}.100Z`,
  });
}

function target(
  testId: string,
  fields: Partial<RecordingEvent['target']>,
): RecordingEvent['target'] {
  return {
    tagName: 'input',
    inputType: 'text',
    role: 'textbox',
    id: null,
    name: null,
    labelText: null,
    accessibleName: null,
    placeholder: null,
    textPreview: null,
    testIdCandidates: [{ attribute: 'data-testid', value: testId }],
    ...fields,
  };
}

function generalEvent(
  sequence: number,
  testId: string,
  eventTarget: RecordingEvent['target'],
  eventType: 'text-input' | 'select' | 'checkbox' | 'radio',
  payload: unknown,
): RecordingEvent {
  const locatorTemplate = artifact.events[0]?.locatorBundle;
  const envelopeTemplate = artifact.events[0];
  if (locatorTemplate === undefined || envelopeTemplate === undefined) {
    throw new Error('Expected the recording fixture to contain an event.');
  }

  return RecordingEventSchema.parse({
    ...envelopeTemplate,
    eventId: fixtureEventId(sequence),
    sequence,
    occurredAt: `2026-07-29T10:00:${String(sequence).padStart(2, '0')}.000Z`,
    recordedAt: `2026-07-29T10:00:${String(sequence).padStart(2, '0')}.100Z`,
    target: eventTarget,
    locatorBundle: {
      ...locatorTemplate,
      primary: {
        ...locatorTemplate.primary,
        locator: {
          kind: 'testId',
          attribute: 'data-testid',
          value: testId,
        },
      },
      generatedAt: `2026-07-29T10:00:${String(sequence).padStart(2, '0')}.000Z`,
    },
    privacyDecision: {
      schemaVersion: 1,
      sensitivity: 'general',
      policy: 'allow',
      confidence: 'low',
      matchedRules: ['GENERAL_NO_SENSITIVE_SIGNAL'],
      reasons: ['No supported sensitive metadata rule matched.'],
    },
    eventType,
    payload,
  });
}

function createConversionArtifact(): RecordingArtifact {
  const clickTemplate = artifact.events[0];
  const maskedTemplate = artifact.events[1];
  const passwordTemplate = artifact.events[2];
  if (
    clickTemplate === undefined ||
    maskedTemplate === undefined ||
    passwordTemplate === undefined
  ) {
    throw new Error('Expected click, masked, and blocked fixture events.');
  }

  const checkboxTarget = target('welcome-option', {
    inputType: 'checkbox',
    role: 'checkbox',
    name: 'sendWelcomeNotification',
    labelText: 'Send welcome notification',
    accessibleName: 'Send welcome notification',
  });
  const checkedEvent = generalEvent(
    6,
    'welcome-option',
    checkboxTarget,
    'checkbox',
    { capturePolicy: 'allow', checked: true },
  );
  const events = [
    withSequence(clickTemplate, 1),
    generalEvent(
      2,
      'customer-note',
      target('customer-note', {
        name: 'customerNote',
        labelText: 'Customer note',
        accessibleName: 'Customer note',
      }),
      'text-input',
      {
        capturePolicy: 'allow',
        value: 'safe integration note',
        truncated: false,
      },
    ),
    withSequence(maskedTemplate, 3),
    withSequence(passwordTemplate, 4),
    generalEvent(
      5,
      'service-package',
      target('service-package', {
        tagName: 'select',
        inputType: null,
        role: 'combobox',
        name: 'servicePackage',
        labelText: 'Service package',
        accessibleName: 'Service package',
      }),
      'select',
      {
        capturePolicy: 'allow',
        value: 'premium',
        label: 'Premium',
        truncated: false,
      },
    ),
    checkedEvent,
    RecordingEventSchema.parse({
      ...checkedEvent,
      eventId: fixtureEventId(7),
      sequence: 7,
      occurredAt: '2026-07-29T10:00:07.000Z',
      recordedAt: '2026-07-29T10:00:07.100Z',
      payload: { capturePolicy: 'allow', checked: false },
    }),
    generalEvent(
      8,
      'premium-plan',
      target('premium-plan', {
        inputType: 'radio',
        role: 'radio',
        name: 'servicePlan',
        labelText: 'Premium plan',
        accessibleName: 'Premium plan',
      }),
      'radio',
      {
        capturePolicy: 'allow',
        checked: true,
        value: 'premium',
        truncated: false,
      },
    ),
  ];

  return RecordingArtifactSchema.parse({
    ...artifact,
    eventCount: events.length,
    lastSequence: events.length,
    events,
    privacySummary: createRecordingPrivacySummary(events),
  });
}

const conversionArtifact = createConversionArtifact();

describe('recording workflow draft conversion integration', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaClient | undefined;
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const recordingSessionIds: string[] = [];
  const workflowIds: string[] = [];
  const suffix = crypto.randomUUID();
  const password = 'Session10 integration password';
  let owner: RegistrationBody;
  let outsider: RegistrationBody;
  let viewer: RegistrationBody;

  async function register(
    prefix: string,
    displayName: string,
  ): Promise<RegistrationBody> {
    if (app === undefined) {
      throw new Error('Integration application was not initialized');
    }
    const email = `${prefix}-${suffix}@example.test`;
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email,
        password,
        displayName,
        organizationName: `${displayName} Organization`,
      })
      .expect(201);
    const registration = {
      ...(response.body as Omit<RegistrationBody, 'email'>),
      email,
    };
    userIds.push(registration.user.id);
    organizationIds.push(registration.organization.id);
    return registration;
  }

  async function createRecording(
    recordingInput: RecordingArtifact,
    complete: boolean,
  ): Promise<string> {
    if (app === undefined) {
      throw new Error('Integration application was not initialized');
    }
    const clientSessionId = crypto.randomUUID();
    const source = RecordingArtifactSchema.parse({
      ...recordingInput,
      clientSessionId,
      events: recordingInput.events.map((event) => ({
        ...event,
        eventId: crypto.randomUUID(),
        sessionId: clientSessionId,
      })),
    });

    const createdResponse = await request(app.getHttpServer())
      .post(`/workspaces/${owner.workspace.id}/recording-sessions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        schemaVersion: source.schemaVersion,
        clientSessionId: source.clientSessionId,
        targetOrigin: source.targetOrigin,
        startedAt: source.startedAt,
        stoppedAt: source.stoppedAt,
        eventCount: source.eventCount,
        lastSequence: source.lastSequence,
        privacySummary: source.privacySummary,
      })
      .expect(200);
    const recordingSessionId = (
      createdResponse.body as { recordingSessionId: string }
    ).recordingSessionId;
    recordingSessionIds.push(recordingSessionId);

    if (source.events.length > 0) {
      await request(app.getHttpServer())
        .post(`/recording-sessions/${recordingSessionId}/batches`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          schemaVersion: 1,
          clientSessionId: source.clientSessionId,
          clientBatchId: `session10-${source.clientSessionId}`,
          eventCount: source.eventCount,
          firstSequence: 1,
          lastSequence: source.lastSequence,
          events: source.events,
        })
        .expect(200);
    }

    if (complete) {
      await request(app.getHttpServer())
        .post(`/recording-sessions/${recordingSessionId}/complete`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          schemaVersion: 1,
          clientSessionId: source.clientSessionId,
          eventCount: source.eventCount,
          lastSequence: source.lastSequence,
          privacySummary: source.privacySummary,
        })
        .expect(200);
    }

    return recordingSessionId;
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

    owner = await register('session10-owner', 'Conversion Owner');
    outsider = await register('session10-outsider', 'Outside Owner');
    viewer = await register('session10-viewer', 'Conversion Viewer');
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
          const conversions = await prisma.recordingWorkflowConversion.findMany(
            {
              where: { recordingSessionId: { in: recordingSessionIds } },
              select: { workflowId: true },
            },
          );
          workflowIds.push(
            ...conversions.map((conversion) => conversion.workflowId),
          );
          await prisma.recordingWorkflowConversion.deleteMany({
            where: { recordingSessionId: { in: recordingSessionIds } },
          });
        }
        if (workflowIds.length > 0) {
          const uniqueWorkflowIds = [...new Set(workflowIds)];
          await prisma.workflowVersion.deleteMany({
            where: { workflowId: { in: uniqueWorkflowIds } },
          });
          await prisma.workflow.deleteMany({
            where: { id: { in: uniqueWorkflowIds } },
          });
        }
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

  it('persists an authorized draft, its report, and exact idempotent retries', async () => {
    if (app === undefined || prisma === undefined) {
      throw new Error('Integration application was not initialized');
    }
    const recordingSessionId = await createRecording(conversionArtifact, true);
    const clientConversionId = crypto.randomUUID();
    const requestBody = {
      clientConversionId,
      name: 'Recorded customer setup',
      description: 'A deterministic Session 10 draft.',
    };

    await request(app.getHttpServer())
      .post(`/recording-sessions/${recordingSessionId}/workflow-drafts`)
      .send(requestBody)
      .expect(401);

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: owner.email, password })
      .expect(200);
    const authenticatedAccessToken = (
      loginResponse.body as { accessToken: string }
    ).accessToken;

    const firstResponse = await request(app.getHttpServer())
      .post(`/recording-sessions/${recordingSessionId}/workflow-drafts`)
      .set('Authorization', `Bearer ${authenticatedAccessToken}`)
      .send(requestBody)
      .expect(200);
    const first = firstResponse.body as WorkflowDraftBody;
    workflowIds.push(first.workflowId);

    expect(first).toMatchObject({
      recordingSessionId,
      clientConversionId,
      version: 1,
      status: 'draft',
      idempotent: false,
    });
    expect(first.generatedStepCount).toBe(8);

    const serializedResponse = JSON.stringify(firstResponse.body);
    for (const forbidden of [
      'events',
      'payload',
      'locatorBundle',
      'record-password',
      'accountPassword',
      'secretName',
    ]) {
      expect(serializedResponse).not.toContain(forbidden);
    }

    const persistedWorkflow = await prisma.workflow.findUniqueOrThrow({
      where: { id: first.workflowId },
    });
    expect(persistedWorkflow.workspaceId).toBe(owner.workspace.id);
    const persistedSource = await prisma.recordingSession.findUniqueOrThrow({
      where: { id: recordingSessionId },
      select: { status: true, workspaceId: true, eventCount: true },
    });
    expect(persistedSource).toEqual({
      status: 'completed',
      workspaceId: owner.workspace.id,
      eventCount: 8,
    });
    await expect(
      prisma.recordingEvent.count({ where: { recordingSessionId } }),
    ).resolves.toBe(8);

    const persistedVersion = await prisma.workflowVersion.findUniqueOrThrow({
      where: { id: first.workflowVersionId },
    });
    expect(persistedVersion.version).toBe(1);
    expect(persistedVersion.status).toBe('draft');
    const workflowDefinition = WorkflowDefinitionSchema.parse(
      persistedVersion.definition,
    );
    expect(workflowDefinition.steps.map((step) => step.type)).toEqual([
      'click',
      'fill',
      'fill',
      'fill',
      'select',
      'setChecked',
      'setChecked',
      'setChecked',
    ]);
    expect(workflowDefinition.steps.map((step) => step.id)).toEqual([
      'step-001',
      'step-002',
      'step-003',
      'step-004',
      'step-005',
      'step-006',
      'step-007',
      'step-008',
    ]);
    expect(workflowDefinition.variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'emailAddress',
          valueType: 'string',
          required: true,
        }),
      ]),
    );
    expect(workflowDefinition.steps[3]).toMatchObject({
      type: 'fill',
      value: { kind: 'secret', secretName: 'password' },
    });
    expect(workflowDefinition.steps.slice(5)).toMatchObject([
      { type: 'setChecked', checked: true },
      { type: 'setChecked', checked: false },
      { type: 'setChecked', checked: true },
    ]);

    const persistedReceipt =
      await prisma.recordingWorkflowConversion.findUniqueOrThrow({
        where: {
          recordingSessionId_clientConversionId: {
            recordingSessionId,
            clientConversionId,
          },
        },
      });
    const conversionReport = RecordingConversionReportSchema.parse(
      persistedReceipt.conversionReport,
    );
    expect(
      conversionReport.mappings.map((mapping) => mapping.sequence),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(
      conversionReport.mappings.map((mapping) =>
        mapping.outcome === 'converted' ? mapping.stepId : null,
      ),
    ).toEqual(workflowDefinition.steps.map((step) => step.id));
    const serializedReport = JSON.stringify(conversionReport);
    expect(serializedReport).not.toContain('safe integration note');
    expect(serializedReport).not.toContain('plaintext-password');
    expect(serializedReport).not.toContain('payload');

    const retryResponse = await request(app.getHttpServer())
      .post(`/recording-sessions/${recordingSessionId}/workflow-drafts`)
      .set('Authorization', `Bearer ${authenticatedAccessToken}`)
      .send(requestBody)
      .expect(200);
    expect(retryResponse.body).toMatchObject({
      workflowId: first.workflowId,
      workflowVersionId: first.workflowVersionId,
      idempotent: true,
    });
    await expect(
      prisma.recordingWorkflowConversion.count({
        where: { recordingSessionId },
      }),
    ).resolves.toBe(1);

    const secondResponse = await request(app.getHttpServer())
      .post(`/recording-sessions/${recordingSessionId}/workflow-drafts`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        ...requestBody,
        clientConversionId: crypto.randomUUID(),
      })
      .expect(200);
    const second = secondResponse.body as WorkflowDraftBody;
    workflowIds.push(second.workflowId);
    expect(second.workflowId).not.toBe(first.workflowId);
    await expect(
      prisma.recordingWorkflowConversion.count({
        where: { recordingSessionId },
      }),
    ).resolves.toBe(2);

    await request(app.getHttpServer())
      .post(`/recording-sessions/${recordingSessionId}/workflow-drafts`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ ...requestBody, clientConversionId: crypto.randomUUID() })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/recording-sessions/${recordingSessionId}/workflow-drafts`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .send({ ...requestBody, clientConversionId: crypto.randomUUID() })
      .expect(403);
  });

  it('rejects a recording that has not completed', async () => {
    if (app === undefined) {
      throw new Error('Integration application was not initialized');
    }
    const incompleteClientSessionId = crypto.randomUUID();
    const incompleteArtifact = RecordingArtifactSchema.parse({
      ...artifact,
      clientSessionId: incompleteClientSessionId,
      events: artifact.events.map((event) => ({
        ...event,
        eventId: crypto.randomUUID(),
        sessionId: incompleteClientSessionId,
      })),
    });
    const recordingSessionId = await createRecording(incompleteArtifact, false);

    await request(app.getHttpServer())
      .post(`/recording-sessions/${recordingSessionId}/workflow-drafts`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        clientConversionId: crypto.randomUUID(),
        name: 'Incomplete recording',
      })
      .expect(409);
  });
});
