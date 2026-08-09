import {
  constants,
  createCipheriv,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
  randomUUID,
} from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createDatabaseClient,
  getRequiredDatabaseUrl,
  OrganizationRole,
  type PrismaClient,
} from '@tasktwin/database';
import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import {
  PlaintextRunInputPayloadSchema,
  RunInputPreparationMetadataSchema,
  SecureRunInputEnvelopeSchema,
  encodeRunInputAad,
} from '@tasktwin/secure-run-inputs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/config/configure-application.js';
import { loadRootEnvironment } from '../src/config/environment.js';
import { OperationalAlertAppender } from '../src/operational-alerts/operational-alert.appender.js';

interface Identity {
  user: { id: string };
  organization: { id: string };
  workspace: { id: string };
  accessToken: string;
}

const suffix = randomUUID();
const workflowId = `session17-${suffix}`;
const secureWorkflowId = `session18-${suffix}`;
const verificationWorkflowId = `session19-${suffix}`;
const extractionWorkflowId = `session20-${suffix}`;
const approvalWorkflowId = `session21-${suffix}`;
const credentialPepper = 'session17-credential-pepper-value-safe';
const leasePepper = 'session17-run-lease-pepper-value-safe';
const pairingPepper = 'session17-pairing-pepper-value-safe-123';
const runnerSoftwareIdentity = {
  product: 'tasktwin-runner',
  version: '0.1.0',
  platform: 'windows',
  architecture: 'x64',
  runnerProtocolVersion: 2,
  workflowSchemaVersion: 1,
  localStateSchemaVersion: 1,
} as const;

function definition(
  version: number,
  status: 'draft' | 'published',
): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId,
    version,
    name: 'Session 17 fixture',
    status,
    variables: [],
    steps: [
      {
        id: 'navigate',
        type: 'navigate',
        name: 'Navigate',
        url: { kind: 'literal', value: 'http://127.0.0.1:4177/path?safe=1' },
      },
      { id: 'wait', type: 'wait', name: 'Wait', durationMs: 10 },
    ],
  };
}

function secureDefinition(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: secureWorkflowId,
    version: 1,
    name: 'Session 18 secure fixture',
    status: 'published',
    variables: [{ name: 'customerName', valueType: 'string', required: true }],
    steps: [
      {
        id: 'navigate',
        type: 'navigate',
        name: 'Navigate',
        url: { kind: 'literal', value: 'http://127.0.0.1:4177/' },
      },
      {
        id: 'fill',
        type: 'fill',
        name: 'Fill',
        locator: { kind: 'label', value: 'Name' },
        value: { kind: 'variable', variableName: 'customerName' },
      },
    ],
  };
}

function verificationDefinition(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: verificationWorkflowId,
    version: 1,
    name: 'Session 19 verification fixture',
    status: 'published',
    variables: [],
    steps: [
      {
        id: 'navigate',
        type: 'navigate',
        name: 'Navigate',
        url: { kind: 'literal', value: 'http://127.0.0.1:4177/result' },
      },
      {
        id: 'verify-url',
        type: 'verify',
        name: 'Verify URL',
        assertion: {
          kind: 'url',
          matchMode: 'origin_and_path',
          expected: { kind: 'literal', value: 'http://127.0.0.1:4177/result' },
        },
      },
    ],
  };
}

function extractionDefinition(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: extractionWorkflowId,
    version: 1,
    name: 'Session 20 extraction fixture',
    status: 'published',
    variables: [],
    steps: [
      {
        id: 'navigate',
        type: 'navigate',
        name: 'Navigate',
        url: { kind: 'literal', value: 'http://127.0.0.1:4177/' },
      },
      {
        id: 'extract',
        type: 'extract',
        name: 'Extract customer ID',
        locator: { kind: 'testId', value: 'customer-id' },
        source: { kind: 'text' },
        outputName: 'customerId',
        retention: 'ephemeral',
      },
      {
        id: 'fill',
        type: 'fill',
        name: 'Fill customer ID',
        locator: { kind: 'label', value: 'Customer ID' },
        value: { kind: 'output', outputName: 'customerId' },
      },
    ],
  };
}

function approvalDefinition(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: approvalWorkflowId,
    version: 1,
    name: 'Session 21 approval fixture',
    status: 'published',
    variables: [],
    steps: [
      {
        id: 'navigate',
        type: 'navigate',
        name: 'Navigate',
        url: { kind: 'literal', value: 'http://127.0.0.1:4177/' },
      },
      {
        id: 'approve-wait',
        type: 'approval',
        name: 'Approve wait',
        message: 'Approve the immediate next wait step.',
        riskLevel: 'medium',
        scope: 'next_step',
        timeoutMs: 120_000,
      },
      { id: 'gated-wait', type: 'wait', name: 'Gated wait', durationMs: 10 },
    ],
  };
}

describe('workflow run dispatch integration', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let owner: Identity;
  let viewer: Identity;
  let outsider: Identity;
  let publishedVersionId: string;
  let draftVersionId: string;
  let secureVersionId: string;
  let verificationVersionId: string;
  let extractionVersionId: string;
  let approvalVersionId: string;
  let runnerDeviceId: string;
  let runnerCredential: string;

  const auth = (identity: Identity) => ({
    Authorization: `Bearer ${identity.accessToken}`,
  });
  const runnerAuth = () => ({
    Authorization: `TaskTwinRunner ${runnerDeviceId}.${runnerCredential}`,
  });

  async function register(label: string): Promise<Identity> {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `session17-${label}-${suffix}@example.test`,
        password: 'Session17 integration password',
        displayName: label,
        organizationName: `Session17 ${label}`,
      })
      .expect(201);
    const identity = response.body as Identity;
    return identity;
  }

  beforeAll(async () => {
    loadRootEnvironment();
    process.env.RUNNER_PAIRING_CODE_PEPPER = pairingPepper;
    process.env.RUNNER_CREDENTIAL_PEPPER = credentialPepper;
    process.env.RUNNER_JOB_LEASE_PEPPER = leasePepper;
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
    viewer = await register('viewer');
    outsider = await register('outsider');
    await prisma.organizationMember.create({
      data: {
        userId: viewer.user.id,
        organizationId: owner.organization.id,
        role: OrganizationRole.VIEWER,
      },
    });
    const workflow = await prisma.workflow.create({
      data: {
        id: workflowId,
        workspaceId: owner.workspace.id,
        name: 'Session 17 fixture',
        versions: {
          create: [
            {
              version: 1,
              status: 'published',
              schemaVersion: 1,
              definition: definition(1, 'published'),
              publishedAt: new Date(),
              publishedById: owner.user.id,
            },
            {
              version: 2,
              status: 'draft',
              schemaVersion: 1,
              definition: definition(2, 'draft'),
            },
          ],
        },
      },
      select: {
        versions: { orderBy: { version: 'asc' }, select: { id: true } },
      },
    });
    publishedVersionId = workflow.versions[0]!.id;
    draftVersionId = workflow.versions[1]!.id;
    const secureWorkflow = await prisma.workflow.create({
      data: {
        id: secureWorkflowId,
        workspaceId: owner.workspace.id,
        name: 'Session 18 secure fixture',
        versions: {
          create: {
            version: 1,
            status: 'published',
            schemaVersion: 1,
            definition: secureDefinition(),
            publishedAt: new Date(),
            publishedById: owner.user.id,
          },
        },
      },
      select: { versions: { select: { id: true } } },
    });
    secureVersionId = secureWorkflow.versions[0]!.id;
    const verificationWorkflow = await prisma.workflow.create({
      data: {
        id: verificationWorkflowId,
        workspaceId: owner.workspace.id,
        name: 'Session 19 verification fixture',
        versions: {
          create: {
            version: 1,
            status: 'published',
            schemaVersion: 1,
            definition: verificationDefinition(),
            publishedAt: new Date(),
            publishedById: owner.user.id,
          },
        },
      },
      select: { versions: { select: { id: true } } },
    });
    verificationVersionId = verificationWorkflow.versions[0]!.id;
    const extractionWorkflow = await prisma.workflow.create({
      data: {
        id: extractionWorkflowId,
        workspaceId: owner.workspace.id,
        name: 'Session 20 extraction fixture',
        versions: {
          create: {
            version: 1,
            status: 'published',
            schemaVersion: 1,
            definition: extractionDefinition(),
            publishedAt: new Date(),
            publishedById: owner.user.id,
          },
        },
      },
      select: { versions: { select: { id: true } } },
    });
    extractionVersionId = extractionWorkflow.versions[0]!.id;
    const approvalWorkflow = await prisma.workflow.create({
      data: {
        id: approvalWorkflowId,
        workspaceId: owner.workspace.id,
        name: 'Session 21 approval fixture',
        versions: {
          create: {
            version: 1,
            status: 'published',
            schemaVersion: 1,
            definition: approvalDefinition(),
            publishedAt: new Date(),
            publishedById: owner.user.id,
          },
        },
      },
      select: { versions: { select: { id: true } } },
    });
    approvalVersionId = approvalWorkflow.versions[0]!.id;

    const pairing = await request(app.getHttpServer())
      .post('/runner-pairing/sessions')
      .send({
        schemaVersion: 1,
        metadata: {
          displayName: `session17-runner-${suffix}`,
          platform: 'win32',
          architecture: 'x64',
          runnerVersion: '0.1.0',
          installationId: randomUUID(),
        },
      })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/workspaces/${owner.workspace.id}/runner-pairing/approve`)
      .set(auth(owner))
      .send({ schemaVersion: 1, userCode: pairing.body.userCode })
      .expect(200);
    const paired = await request(app.getHttpServer())
      .post('/runner-pairing/token')
      .send({ schemaVersion: 1, deviceCode: pairing.body.deviceCode })
      .expect(200);
    runnerDeviceId = paired.body.runnerDeviceId as string;
    runnerCredential = paired.body.credential as string;
    await request(app.getHttpServer())
      .post('/runner/heartbeat')
      .set(runnerAuth())
      .send({
        schemaVersion: 1,
        runnerVersion: runnerSoftwareIdentity.version,
        softwareIdentity: runnerSoftwareIdentity,
      })
      .expect(200);
  });

  afterAll(async () => {
    await prisma.workflowRunInputEnvelope.deleteMany({
      where: { workflowRun: { workflowId: secureWorkflowId } },
    });
    await prisma.workflowRunInputPreparation.deleteMany({
      where: { workflowVersion: { workflowId: secureWorkflowId } },
    });
    await prisma.workflowRunProgressBatch.deleteMany({
      where: {
        workflowRun: {
          workflowId: {
            in: [
              workflowId,
              secureWorkflowId,
              verificationWorkflowId,
              extractionWorkflowId,
              approvalWorkflowId,
            ],
          },
        },
      },
    });
    await prisma.workflowRunStep.deleteMany({
      where: {
        workflowRun: {
          workflowId: {
            in: [
              workflowId,
              secureWorkflowId,
              verificationWorkflowId,
              extractionWorkflowId,
              approvalWorkflowId,
            ],
          },
        },
      },
    });
    await prisma.workflowRun.deleteMany({
      where: {
        workflowId: {
          in: [
            workflowId,
            secureWorkflowId,
            verificationWorkflowId,
            extractionWorkflowId,
            approvalWorkflowId,
          ],
        },
      },
    });
    await prisma.workflowVersion.deleteMany({
      where: {
        workflowId: {
          in: [
            workflowId,
            secureWorkflowId,
            verificationWorkflowId,
            extractionWorkflowId,
            approvalWorkflowId,
          ],
        },
      },
    });
    await prisma.workflow.deleteMany({
      where: {
        id: {
          in: [
            workflowId,
            secureWorkflowId,
            verificationWorkflowId,
            extractionWorkflowId,
            approvalWorkflowId,
          ],
        },
      },
    });
    await prisma.runnerEncryptionKey.deleteMany({ where: { runnerDeviceId } });
    await prisma.runnerCredential.deleteMany({ where: { runnerDeviceId } });
    await prisma.runnerDevice.deleteMany({ where: { id: runnerDeviceId } });
    await prisma.runnerPairingSession.deleteMany({
      where: { displayName: { startsWith: 'session17-runner-' } },
    });
    // Workflow lifecycle operations append immutable workspace audit events.
    // Retain their registration graph rather than disabling the production
    // immutability trigger merely to clean the integration database.
    await prisma.$disconnect();
    await app?.close();
  });

  it('creates, claims, synchronizes and completes idempotently', async () => {
    const clientRunId = randomUUID();
    const createBody = {
      schemaVersion: 1,
      clientRunId,
      runnerDeviceId,
    };
    const created = await request(app.getHttpServer())
      .post(`/workflow-versions/${publishedVersionId}/runs`)
      .set(auth(owner))
      .send(createBody)
      .expect(200);
    const runId = created.body.run.id as string;
    expect(created.body.idempotent).toBe(false);
    expect(created.body.run.steps).toHaveLength(2);
    await request(app.getHttpServer())
      .post(`/workflow-versions/${publishedVersionId}/runs`)
      .set(auth(owner))
      .send(createBody)
      .expect(200)
      .expect(({ body }) => {
        expect(body.idempotent).toBe(true);
        expect(body.run.id).toBe(runId);
      });
    expect(await prisma.workflowRun.count({ where: { id: runId } })).toBe(1);
    expect(
      await prisma.workflowRunStep.count({ where: { workflowRunId: runId } }),
    ).toBe(2);

    await request(app.getHttpServer())
      .post(`/workflow-versions/${draftVersionId}/runs`)
      .set(auth(owner))
      .send({ ...createBody, clientRunId: randomUUID() })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/workflow-versions/${publishedVersionId}/runs`)
      .set(auth(viewer))
      .send({ ...createBody, clientRunId: randomUUID() })
      .expect(403);

    const claimAttemptId = randomUUID();
    const claimBody = {
      schemaVersion: 1,
      runProtocolVersion: 2,
      workflowSchemaVersion: 1,
      workflowEngineSchemaVersion: 1,
      runnerVersion: '0.1.0',
      claimAttemptId,
    };
    const firstClaim = await request(app.getHttpServer())
      .post('/runner/jobs/claim')
      .set(runnerAuth())
      .send(claimBody)
      .expect(200);
    expect(firstClaim.body.status).toBe('claimed');
    expect(firstClaim.body.job).toMatchObject({
      runProtocolVersion: 2,
      workflowSchemaVersion: 1,
    });
    const leaseToken = firstClaim.body.job.leaseToken as string;
    const retryClaim = await request(app.getHttpServer())
      .post('/runner/jobs/claim')
      .set(runnerAuth())
      .send(claimBody)
      .expect(200);
    expect(retryClaim.body).toEqual(firstClaim.body);
    const storedClaim = await prisma.workflowRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(storedClaim.leaseTokenHash).toHaveLength(64);
    expect(JSON.stringify(storedClaim)).not.toContain(leaseToken);

    const leaseHeaders = {
      ...runnerAuth(),
      'X-TaskTwin-Run-Lease': leaseToken,
    };
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/lease/renew`)
      .set(leaseHeaders)
      .send({ schemaVersion: 1 })
      .expect(200);

    const timestamp = '2026-07-31T12:00:00.000Z';
    const events = [
      ['run_status_changed', { status: 'pending' }],
      ['run_status_changed', { status: 'validating' }],
      [
        'step_status_changed',
        { stepId: 'navigate', stepType: 'navigate', status: 'pending' },
      ],
      [
        'step_status_changed',
        { stepId: 'wait', stepType: 'wait', status: 'pending' },
      ],
      ['run_status_changed', { status: 'starting' }],
      ['run_status_changed', { status: 'running' }],
      [
        'step_status_changed',
        { stepId: 'navigate', stepType: 'navigate', status: 'running' },
      ],
      [
        'step_status_changed',
        { stepId: 'navigate', stepType: 'navigate', status: 'succeeded' },
      ],
      [
        'step_status_changed',
        { stepId: 'wait', stepType: 'wait', status: 'running' },
      ],
      [
        'step_status_changed',
        { stepId: 'wait', stepType: 'wait', status: 'succeeded' },
      ],
      ['run_status_changed', { status: 'succeeded' }],
    ].map(([kind, data], index) => ({
      sequence: index + 1,
      event: { executionId: runId, timestamp, kind, ...data },
    }));
    const batch = {
      schemaVersion: 1,
      clientBatchId: randomUUID(),
      firstSequence: 1,
      lastSequence: events.length,
      events,
    };
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/progress`)
      .set(leaseHeaders)
      .send(batch)
      .expect(200)
      .expect(({ body }) => expect(body.idempotent).toBe(false));
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/progress`)
      .set(leaseHeaders)
      .send(batch)
      .expect(200)
      .expect(({ body }) => expect(body.idempotent).toBe(true));
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/progress`)
      .set(leaseHeaders)
      .send({
        ...batch,
        clientBatchId: randomUUID(),
        firstSequence: events.length + 2,
        lastSequence: events.length + 2,
        events: [
          {
            sequence: events.length + 2,
            event: events.at(-1)!.event,
          },
        ],
      })
      .expect(409);

    const completionId = randomUUID();
    const completion = {
      schemaVersion: 1,
      clientCompletionId: completionId,
      result: {
        schemaVersion: 1,
        executionId: runId,
        workflowId,
        workflowVersion: 1,
        status: 'succeeded',
        startedAt: timestamp,
        finishedAt: '2026-07-31T12:00:00.020Z',
        durationMs: 20,
        terminationCause: 'completed',
        counts: {
          total: 2,
          attempted: 2,
          succeeded: 2,
          failed: 0,
          cancelled: 0,
          timedOut: 0,
          skipped: 0,
        },
        warnings: [],
        steps: [
          {
            stepId: 'navigate',
            stepType: 'navigate',
            status: 'succeeded',
            startedAt: timestamp,
            finishedAt: timestamp,
            durationMs: 0,
          },
          {
            stepId: 'wait',
            stepType: 'wait',
            status: 'succeeded',
            startedAt: timestamp,
            finishedAt: '2026-07-31T12:00:00.010Z',
            durationMs: 10,
          },
        ],
      },
    };
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/complete`)
      .set(leaseHeaders)
      .send(completion)
      .expect(200)
      .expect(({ body }) => expect(body.run.status).toBe('SUCCEEDED'));
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/complete`)
      .set(leaseHeaders)
      .send(completion)
      .expect(200)
      .expect(({ body }) => expect(body.idempotent).toBe(true));
    expect(
      await prisma.workflowRunStep.count({
        where: { workflowRunId: runId, status: 'SUCCEEDED' },
      }),
    ).toBe(2);

    await request(app.getHttpServer())
      .get(`/workflow-runs/${runId}`)
      .set(auth(outsider))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/workflow-runs/${runId}`)
      .set(auth(viewer))
      .expect(200);
  });

  it('allows compatible software and blocks required, unsupported, and revoked Runners', async () => {
    const createdRunIds: string[] = [];
    const reportSoftware = async (
      version: string,
      runnerProtocolVersion: number,
      expectedCompatibility: 'compatible' | 'update_required' | 'unsupported',
      serviceStatus?: 'running' | 'draining',
    ) => {
      await request(app.getHttpServer())
        .post('/runner/heartbeat')
        .set(runnerAuth())
        .send({
          schemaVersion: 1,
          runnerVersion: version,
          softwareIdentity: {
            ...runnerSoftwareIdentity,
            version,
            runnerProtocolVersion,
          },
          ...(serviceStatus === undefined
            ? {}
            : {
                runtime: {
                  schemaVersion: 1,
                  runtimeMode: 'service',
                  autonomyLevel: 'boot_resilient',
                  serviceStatus,
                  secretUnlockMode: 'os_native',
                  restartResilient: true,
                },
              }),
        })
        .expect('TaskTwin-Runner-Compatibility', expectedCompatibility)
        .expect(200);
    };
    const createQueuedRun = async () => {
      const response = await request(app.getHttpServer())
        .post(`/workflow-versions/${publishedVersionId}/runs`)
        .set(auth(owner))
        .send({
          schemaVersion: 1,
          clientRunId: randomUUID(),
          runnerDeviceId,
        })
        .expect(200);
      const runId = response.body.run.id as string;
      createdRunIds.push(runId);
      return runId;
    };
    const claim = (version: string) =>
      request(app.getHttpServer())
        .post('/runner/jobs/claim')
        .set(runnerAuth())
        .send({
          schemaVersion: 1,
          runProtocolVersion: 2,
          workflowSchemaVersion: 1,
          workflowEngineSchemaVersion: 1,
          runnerVersion: version,
          claimAttemptId: randomUUID(),
        });

    try {
      await reportSoftware('0.1.0', 2, 'compatible');
      const compatibleRunId = await createQueuedRun();
      await claim('0.1.0')
        .expect(200)
        .expect(({ body }) => expect(body.status).toBe('claimed'));
      expect(
        await prisma.workflowRun.findUniqueOrThrow({
          where: { id: compatibleRunId },
        }),
      ).toMatchObject({ status: 'CLAIMED' });

      await prisma.workflowRun.update({
        where: { id: compatibleRunId },
        data: {
          status: 'CANCELLED',
          finishedAt: new Date(),
          leaseTokenHash: null,
          leaseExpiresAt: null,
        },
      });

      const maintenanceRunId = await createQueuedRun();
      await reportSoftware('0.1.0', 2, 'compatible', 'draining');
      await claim('0.1.0')
        .expect(200)
        .expect(({ body }) => expect(body.status).toBe('no_job'));
      expect(
        await prisma.workflowRun.findUniqueOrThrow({
          where: { id: maintenanceRunId },
        }),
      ).toMatchObject({ status: 'QUEUED', claimedAt: null });

      await reportSoftware('0.1.0', 2, 'compatible', 'running');
      await claim('0.1.0')
        .expect(200)
        .expect(({ body }) => expect(body.status).toBe('claimed'));
      await prisma.workflowRun.update({
        where: { id: maintenanceRunId },
        data: {
          status: 'CANCELLED',
          finishedAt: new Date(),
          leaseTokenHash: null,
          leaseExpiresAt: null,
        },
      });

      const incompatibleProtocolRunId = await createQueuedRun();
      await prisma.workflowRun.update({
        where: { id: incompatibleProtocolRunId },
        data: { runProtocolVersion: 1 },
      });
      await claim('0.1.0')
        .expect(200)
        .expect(({ body }) => expect(body.status).toBe('no_job'));
      expect(
        await prisma.workflowRun.findUniqueOrThrow({
          where: { id: incompatibleProtocolRunId },
        }),
      ).toMatchObject({
        status: 'QUEUED',
        runProtocolVersion: 1,
        claimedAt: null,
      });

      await reportSoftware('0.0.4', 2, 'update_required');
      const blockedRunId = await createQueuedRun();
      await claim('0.0.4')
        .expect(200)
        .expect(({ body }) => expect(body.status).toBe('no_job'));
      expect(
        await prisma.workflowRun.findUniqueOrThrow({
          where: { id: blockedRunId },
        }),
      ).toMatchObject({ status: 'QUEUED', claimedAt: null });

      await reportSoftware('0.1.0', 99, 'unsupported');
      await claim('0.1.0')
        .expect(200)
        .expect(({ body }) => expect(body.status).toBe('no_job'));

      await request(app.getHttpServer())
        .post('/runner/heartbeat')
        .set(runnerAuth())
        .send({ schemaVersion: 1, runnerVersion: '0.1.0' })
        .expect('TaskTwin-Runner-Compatibility', 'update_required')
        .expect(200);
      await request(app.getHttpServer())
        .post('/runner/jobs/claim')
        .set(runnerAuth())
        .send({
          schemaVersion: 1,
          runProtocolVersion: 2,
          workflowEngineSchemaVersion: 1,
          runnerVersion: '0.1.0',
          claimAttemptId: randomUUID(),
        })
        .expect(200)
        .expect(({ body }) => expect(body.status).toBe('no_job'));

      await reportSoftware('0.1.0', 2, 'compatible');
      await prisma.runnerDevice.update({
        where: { id: runnerDeviceId },
        data: { revokedAt: new Date() },
      });
      await claim('0.1.0').expect(401);
      expect(
        await prisma.workflowRun.findUniqueOrThrow({
          where: { id: blockedRunId },
        }),
      ).toMatchObject({ status: 'QUEUED', claimedAt: null });
    } finally {
      await prisma.runnerDevice.update({
        where: { id: runnerDeviceId },
        data: { revokedAt: null },
      });
      if (createdRunIds.length > 0) {
        await prisma.workflowRunStep.deleteMany({
          where: { workflowRunId: { in: createdRunIds } },
        });
        await prisma.workflowRun.deleteMany({
          where: { id: { in: createdRunIds } },
        });
      }
    }
  });

  it('persists distinct recurring schedule auto-pause alert lifecycles', async () => {
    const appender = app.get(OperationalAlertAppender);
    const scheduleId = randomUUID();
    const firstOccurrenceId = randomUUID();
    const secondOccurrenceId = randomUUID();
    const alertInput = (occurrenceId: string, at: string) =>
      ({
        schemaVersion: 1,
        workspaceId: owner.workspace.id,
        type: 'schedule_auto_paused',
        source: {
          type: 'workflow_schedule_occurrence',
          id: occurrenceId,
        },
        primaryEntity: { type: 'workflow_schedule', id: scheduleId },
        relatedEntities: [
          { type: 'workflow_schedule_occurrence', id: occurrenceId },
        ],
        template: {
          schemaVersion: 1,
          templateKey: 'schedule_auto_paused.v1',
          workflowScheduleId: scheduleId,
          reason: 'runner_update_required',
          autoPausedAt: at,
          occurrenceId,
        },
        actionTarget: {
          schemaVersion: 1,
          kind: 'schedule',
          workspaceId: owner.workspace.id,
          workflowScheduleId: scheduleId,
        },
        creatorUserId: owner.user.id,
      }) as const;

    try {
      await prisma.$transaction(async (transaction) => {
        await appender.append(
          transaction,
          alertInput(firstOccurrenceId, '2026-08-09T09:00:00.000Z'),
        );
        await appender.resolve(transaction, {
          workspaceId: owner.workspace.id,
          type: 'schedule_auto_paused',
          sourceType: 'workflow_schedule_occurrence',
          sourceId: firstOccurrenceId,
          reason: 'resumed',
          resolvedByUserId: owner.user.id,
        });
        await appender.append(
          transaction,
          alertInput(secondOccurrenceId, '2026-08-09T10:00:00.000Z'),
        );
        await appender.resolve(transaction, {
          workspaceId: owner.workspace.id,
          type: 'schedule_auto_paused',
          sourceType: 'workflow_schedule_occurrence',
          sourceId: secondOccurrenceId,
          reason: 'archived',
          resolvedByUserId: owner.user.id,
        });
      });

      await expect(
        prisma.operationalAlert.findMany({
          where: {
            workspaceId: owner.workspace.id,
            sourceType: 'workflow_schedule_occurrence',
            sourceId: { in: [firstOccurrenceId, secondOccurrenceId] },
          },
          orderBy: { sourceId: 'asc' },
        }),
      ).resolves.toHaveLength(2);
    } finally {
      const alerts = await prisma.operationalAlert.findMany({
        where: {
          workspaceId: owner.workspace.id,
          sourceType: 'workflow_schedule_occurrence',
          sourceId: { in: [firstOccurrenceId, secondOccurrenceId] },
        },
        select: { id: true },
      });
      await prisma.notificationOutboxMessage.deleteMany({
        where: { alertId: { in: alerts.map((alert) => alert.id) } },
      });
      await prisma.operationalAlert.deleteMany({
        where: {
          workspaceId: owner.workspace.id,
          sourceType: 'workflow_schedule_occurrence',
          sourceId: { in: [firstOccurrenceId, secondOccurrenceId] },
        },
      });
    }
  });

  it('serializes concurrent claims and cooperatively completes cancellation', async () => {
    const queuedRunIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const created = await request(app.getHttpServer())
        .post(`/workflow-versions/${publishedVersionId}/runs`)
        .set(auth(owner))
        .send({
          schemaVersion: 1,
          clientRunId: randomUUID(),
          runnerDeviceId,
        })
        .expect(200);
      queuedRunIds.push(created.body.run.id as string);
    }
    const claimRequest = () =>
      request(app.getHttpServer())
        .post('/runner/jobs/claim')
        .set(runnerAuth())
        .send({
          schemaVersion: 1,
          runProtocolVersion: 2,
          workflowSchemaVersion: 1,
          workflowEngineSchemaVersion: 1,
          runnerVersion: '0.1.0',
          claimAttemptId: randomUUID(),
        });
    const claims = await Promise.all([claimRequest(), claimRequest()]);
    expect(claims.map((response) => response.status)).toEqual([200, 200]);
    const claimed = claims.find(
      (response) => response.body.status === 'claimed',
    );
    expect(
      claims.filter((response) => response.body.status === 'claimed'),
    ).toHaveLength(1);
    expect(
      claims.filter((response) => response.body.status === 'no_job'),
    ).toHaveLength(1);
    if (claimed === undefined) {
      throw new Error('A concurrent claim must succeed.');
    }
    const runId = claimed.body.job.runId as string;
    const leaseToken = claimed.body.job.leaseToken as string;
    expect(queuedRunIds).toContain(runId);
    expect(
      await prisma.workflowRun.count({
        where: {
          runnerDeviceId,
          status: { in: ['CLAIMED', 'RUNNING', 'CANCEL_REQUESTED'] },
        },
      }),
    ).toBe(1);

    await request(app.getHttpServer())
      .post(`/workflow-runs/${runId}/cancel`)
      .set(auth(owner))
      .send({ schemaVersion: 1 })
      .expect(200)
      .expect(({ body }) => expect(body.run.status).toBe('CANCEL_REQUESTED'));
    const leaseHeaders = {
      ...runnerAuth(),
      'X-TaskTwin-Run-Lease': leaseToken,
    };
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/lease/renew`)
      .set(leaseHeaders)
      .send({ schemaVersion: 1 })
      .expect(200)
      .expect(({ body }) => expect(body.cancelRequested).toBe(true));

    const timestamp = '2026-07-31T12:01:00.000Z';
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/complete`)
      .set(leaseHeaders)
      .send({
        schemaVersion: 1,
        clientCompletionId: randomUUID(),
        result: {
          schemaVersion: 1,
          executionId: runId,
          workflowId,
          workflowVersion: 1,
          status: 'cancelled',
          startedAt: timestamp,
          finishedAt: timestamp,
          durationMs: 0,
          terminationCause: 'run_cancelled',
          counts: {
            total: 2,
            attempted: 0,
            succeeded: 0,
            failed: 0,
            cancelled: 0,
            timedOut: 0,
            skipped: 2,
          },
          warnings: [],
          steps: [
            {
              stepId: 'navigate',
              stepType: 'navigate',
              status: 'skipped',
              finishedAt: timestamp,
              durationMs: 0,
              skippedReason: 'run_cancelled',
            },
            {
              stepId: 'wait',
              stepType: 'wait',
              status: 'skipped',
              finishedAt: timestamp,
              durationMs: 0,
              skippedReason: 'run_cancelled',
            },
          ],
        },
      })
      .expect(200)
      .expect(({ body }) => expect(body.run.status).toBe('CANCELLED'));

    const remainingRunId = queuedRunIds.find((id) => id !== runId);
    if (remainingRunId === undefined) {
      throw new Error('The second queued run must remain available.');
    }
    await request(app.getHttpServer())
      .post(`/workflow-runs/${remainingRunId}/cancel`)
      .set(auth(owner))
      .send({ schemaVersion: 1 })
      .expect(200)
      .expect(({ body }) => expect(body.run.status).toBe('CANCELLED'));
  });

  it('cancels queued work and interrupts an expired claimed run', async () => {
    const queued = await request(app.getHttpServer())
      .post(`/workflow-versions/${publishedVersionId}/runs`)
      .set(auth(owner))
      .send({
        schemaVersion: 1,
        clientRunId: randomUUID(),
        runnerDeviceId,
      })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/workflow-runs/${queued.body.run.id}/cancel`)
      .set(auth(owner))
      .send({ schemaVersion: 1 })
      .expect(200)
      .expect(({ body }) => expect(body.run.status).toBe('CANCELLED'));

    const active = await request(app.getHttpServer())
      .post(`/workflow-versions/${publishedVersionId}/runs`)
      .set(auth(owner))
      .send({
        schemaVersion: 1,
        clientRunId: randomUUID(),
        runnerDeviceId,
      })
      .expect(200);
    const claimed = await request(app.getHttpServer())
      .post('/runner/jobs/claim')
      .set(runnerAuth())
      .send({
        schemaVersion: 1,
        runProtocolVersion: 2,
        workflowSchemaVersion: 1,
        workflowEngineSchemaVersion: 1,
        runnerVersion: '0.1.0',
        claimAttemptId: randomUUID(),
      })
      .expect(200);
    const runId = active.body.run.id as string;
    expect(claimed.body.job.runId).toBe(runId);
    await prisma.workflowRun.update({
      where: { id: runId },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    await request(app.getHttpServer())
      .get(`/workflow-runs/${runId}`)
      .set(auth(owner))
      .expect(200)
      .expect(({ body }) => expect(body.run.status).toBe('INTERRUPTED'));
    expect(
      await prisma.workflowRun.findUniqueOrThrow({ where: { id: runId } }),
    ).toMatchObject({ status: 'INTERRUPTED', leaseTokenHash: null });
  });

  it('prepares, commits and dispatches ciphertext only to the assigned Runner', async () => {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 3_072,
      publicExponent: 0x10001,
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });
    const keyId = `rk1_${randomBytes(32).toString('base64url')}`;
    const key = {
      schemaVersion: 1,
      keyId,
      profile: 'secure_input_envelope_v1',
      algorithm: 'RSA-OAEP-256',
      publicKeyFormat: 'spki',
      publicKeySpki: pair.publicKey.toString('base64url'),
      fingerprint: createHash('sha256').update(pair.publicKey).digest('hex'),
    };
    await request(app.getHttpServer())
      .post('/runner/heartbeat')
      .set(runnerAuth())
      .send({
        schemaVersion: 1,
        runnerVersion: runnerSoftwareIdentity.version,
        softwareIdentity: runnerSoftwareIdentity,
        capabilities: ['secure_input_envelope_v1'],
      })
      .expect(200);
    const registration = { schemaVersion: 1, key };
    await request(app.getHttpServer())
      .post('/runner/encryption-keys')
      .set(runnerAuth())
      .send(registration)
      .expect(200)
      .expect(({ body }) => expect(body.idempotent).toBe(false));
    await request(app.getHttpServer())
      .post('/runner/encryption-keys')
      .set(runnerAuth())
      .send(registration)
      .expect(200)
      .expect(({ body }) => expect(body.idempotent).toBe(true));

    await request(app.getHttpServer())
      .post(`/workflow-versions/${secureVersionId}/runs`)
      .set(auth(owner))
      .send({ schemaVersion: 1, runnerDeviceId, clientRunId: randomUUID() })
      .expect(409);

    const preparationBody = {
      schemaVersion: 1,
      clientPreparationId: randomUUID(),
      clientRunId: randomUUID(),
      runnerDeviceId,
      options: { totalTimeoutMs: 120_000, stepTimeoutMs: 30_000 },
    };
    await request(app.getHttpServer())
      .post(`/workflow-versions/${secureVersionId}/run-preparations`)
      .set(auth(viewer))
      .send({ ...preparationBody, clientPreparationId: randomUUID() })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/workflow-versions/${secureVersionId}/run-preparations`)
      .set(auth(outsider))
      .send({ ...preparationBody, clientPreparationId: randomUUID() })
      .expect(404);
    const preparedResponse = await request(app.getHttpServer())
      .post(`/workflow-versions/${secureVersionId}/run-preparations`)
      .set(auth(owner))
      .send(preparationBody)
      .expect(200);
    const prepared = RunInputPreparationMetadataSchema.parse(
      preparedResponse.body.preparation,
    );
    expect(prepared.manifest.variables).toEqual([
      expect.objectContaining({ name: 'customerName', requiredForRun: true }),
    ]);
    expect(JSON.stringify(prepared)).not.toContain('Session18 safe customer');

    const plaintextValue = 'Session18 safe customer';
    const payload = PlaintextRunInputPayloadSchema.parse({
      schemaVersion: 1,
      preparationId: prepared.preparationId,
      workflowRunId: prepared.workflowRunId,
      workflowVersionId: prepared.workflowVersionId,
      runnerDeviceId: prepared.runnerDeviceId,
      keyId,
      expiresAt: prepared.expiresAt,
      inputs: {
        schemaVersion: 1,
        values: {
          customerName: { kind: 'string', value: plaintextValue },
        },
      },
    });
    const aad = Buffer.from(encodeRunInputAad(prepared.aad));
    const aesKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const publicKey = createPublicKey({
      key: pair.publicKey,
      format: 'der',
      type: 'spki',
    });
    const wrappedKey = publicEncrypt(
      {
        key: publicKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      aesKey,
    );
    aesKey.fill(0);
    const envelope = SecureRunInputEnvelopeSchema.parse({
      schemaVersion: 1,
      profile: 'secure_input_envelope_v1',
      contentEncryption: 'AES-256-GCM',
      keyEncryption: 'RSA-OAEP-256',
      preparationId: prepared.preparationId,
      workflowRunId: prepared.workflowRunId,
      keyId,
      expiresAt: prepared.expiresAt,
      aad: aad.toString('base64url'),
      iv: iv.toString('base64url'),
      wrappedKey: wrappedKey.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      ciphertextDigest: createHash('sha256').update(ciphertext).digest('hex'),
    });
    const committed = await request(app.getHttpServer())
      .post(`/run-preparations/${prepared.preparationId}/commit`)
      .set(auth(owner))
      .send({ schemaVersion: 1, envelope })
      .expect(200);
    expect(committed.body.run.id).toBe(prepared.workflowRunId);
    await request(app.getHttpServer())
      .post(`/run-preparations/${prepared.preparationId}/commit`)
      .set(auth(owner))
      .send({ schemaVersion: 1, envelope })
      .expect(200)
      .expect(({ body }) => expect(body.idempotent).toBe(true));
    await request(app.getHttpServer())
      .post(`/run-preparations/${prepared.preparationId}/commit`)
      .set(auth(owner))
      .send({
        schemaVersion: 1,
        envelope: { ...envelope, ciphertextDigest: 'f'.repeat(64) },
      })
      .expect(409);

    const stored = await prisma.workflowRunInputEnvelope.findUniqueOrThrow({
      where: { workflowRunId: prepared.workflowRunId },
    });
    expect(JSON.stringify(stored)).not.toContain(plaintextValue);
    expect(stored.ciphertext).toBe(envelope.ciphertext);
    expect(
      await prisma.workflowRunStep.count({
        where: { workflowRunId: prepared.workflowRunId },
      }),
    ).toBe(2);

    const claimed = await request(app.getHttpServer())
      .post('/runner/jobs/claim')
      .set(runnerAuth())
      .send({
        schemaVersion: 1,
        runProtocolVersion: 2,
        workflowSchemaVersion: 1,
        workflowEngineSchemaVersion: 1,
        runnerVersion: '0.1.0',
        claimAttemptId: randomUUID(),
      })
      .expect(200);
    expect(claimed.body.job.runId).toBe(prepared.workflowRunId);
    expect(claimed.body.job.runtimeInput.kind).toBe('encrypted_envelope');
    expect(JSON.stringify(claimed.body)).not.toContain(plaintextValue);
    await prisma.workflowRun.update({
      where: { id: prepared.workflowRunId },
      data: {
        status: 'INTERRUPTED',
        leaseTokenHash: null,
        leaseExpiresAt: null,
        finishedAt: new Date(),
      },
    });
  });

  it('rejects an incompatible Runner and accepts verification capability', async () => {
    const requestBody = {
      schemaVersion: 1,
      runnerDeviceId,
      clientRunId: randomUUID(),
    };
    await request(app.getHttpServer())
      .post(`/workflow-versions/${verificationVersionId}/runs`)
      .set(auth(owner))
      .send(requestBody)
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('RUNNER_CAPABILITY_UNAVAILABLE');
      });

    await request(app.getHttpServer())
      .post('/runner/heartbeat')
      .set(runnerAuth())
      .send({
        schemaVersion: 1,
        runnerVersion: runnerSoftwareIdentity.version,
        softwareIdentity: runnerSoftwareIdentity,
        capabilities: ['secure_input_envelope_v1', 'workflow_verification_v1'],
      })
      .expect(200);

    const created = await request(app.getHttpServer())
      .post(`/workflow-versions/${verificationVersionId}/runs`)
      .set(auth(owner))
      .send({ ...requestBody, clientRunId: randomUUID() })
      .expect(200)
      .expect(({ body }) => {
        expect(body.run.steps).toHaveLength(2);
      });
    await request(app.getHttpServer())
      .post(`/workflow-runs/${created.body.run.id as string}/cancel`)
      .set(auth(owner))
      .send({ schemaVersion: 1 })
      .expect(200);
  });

  it('gates Extract workflows and creates metadata-only output rows', async () => {
    const requestBody = {
      schemaVersion: 1,
      runnerDeviceId,
      clientRunId: randomUUID(),
    };
    await request(app.getHttpServer())
      .post(`/workflow-versions/${extractionVersionId}/runs`)
      .set(auth(owner))
      .send(requestBody)
      .expect(409);

    await request(app.getHttpServer())
      .post('/runner/heartbeat')
      .set(runnerAuth())
      .send({
        schemaVersion: 1,
        runnerVersion: runnerSoftwareIdentity.version,
        softwareIdentity: runnerSoftwareIdentity,
        capabilities: [
          'secure_input_envelope_v1',
          'workflow_verification_v1',
          'workflow_extraction_v1',
        ],
      })
      .expect(200);

    const created = await request(app.getHttpServer())
      .post(`/workflow-versions/${extractionVersionId}/runs`)
      .set(auth(owner))
      .send({ ...requestBody, clientRunId: randomUUID() })
      .expect(200);
    expect(created.body.run.outputs).toEqual([
      expect.objectContaining({
        outputName: 'customerId',
        outputType: 'string',
        producerStepId: 'extract',
        status: 'not_produced',
      }),
    ]);
    const rows = await prisma.workflowRunOutput.findMany({
      where: { workflowRunId: created.body.run.id as string },
    });
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {})).not.toEqual(
      expect.arrayContaining(['value', 'hash', 'length', 'preview', 'locator']),
    );

    const runId = created.body.run.id as string;
    const claimed = await request(app.getHttpServer())
      .post('/runner/jobs/claim')
      .set(runnerAuth())
      .send({
        schemaVersion: 1,
        runProtocolVersion: 2,
        workflowSchemaVersion: 1,
        workflowEngineSchemaVersion: 1,
        runnerVersion: '0.1.0',
        claimAttemptId: randomUUID(),
      })
      .expect(200);
    expect(claimed.body.job.runId).toBe(runId);
    const leaseHeaders = {
      ...runnerAuth(),
      'X-TaskTwin-Run-Lease': claimed.body.job.leaseToken as string,
    };
    const timestamp = '2026-08-02T12:00:00.000Z';
    const events = [
      ['run_status_changed', { status: 'pending' }],
      ['run_status_changed', { status: 'validating' }],
      [
        'step_status_changed',
        { stepId: 'navigate', stepType: 'navigate', status: 'pending' },
      ],
      [
        'step_status_changed',
        { stepId: 'extract', stepType: 'extract', status: 'pending' },
      ],
      [
        'step_status_changed',
        { stepId: 'fill', stepType: 'fill', status: 'pending' },
      ],
      ['run_status_changed', { status: 'starting' }],
      ['run_status_changed', { status: 'running' }],
      [
        'step_status_changed',
        { stepId: 'navigate', stepType: 'navigate', status: 'running' },
      ],
      [
        'step_status_changed',
        { stepId: 'navigate', stepType: 'navigate', status: 'succeeded' },
      ],
      [
        'step_status_changed',
        { stepId: 'extract', stepType: 'extract', status: 'running' },
      ],
      [
        'output_produced',
        {
          producerStepId: 'extract',
          outputName: 'customerId',
          outputType: 'string',
        },
      ],
      [
        'step_status_changed',
        { stepId: 'extract', stepType: 'extract', status: 'succeeded' },
      ],
      [
        'step_status_changed',
        { stepId: 'fill', stepType: 'fill', status: 'running' },
      ],
      [
        'step_status_changed',
        { stepId: 'fill', stepType: 'fill', status: 'succeeded' },
      ],
      ['run_status_changed', { status: 'succeeded' }],
    ].map(([kind, data], index) => ({
      sequence: index + 1,
      event: { executionId: runId, timestamp, kind, ...data },
    }));
    const progressBatch = {
      schemaVersion: 1,
      clientBatchId: randomUUID(),
      firstSequence: 1,
      lastSequence: events.length,
      events,
    };
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/progress`)
      .set(leaseHeaders)
      .send(progressBatch)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/progress`)
      .set(leaseHeaders)
      .send(progressBatch)
      .expect(200)
      .expect(({ body }) => expect(body.idempotent).toBe(true));

    const result = {
      schemaVersion: 1,
      executionId: runId,
      workflowId: extractionWorkflowId,
      workflowVersion: 1,
      status: 'succeeded',
      startedAt: timestamp,
      finishedAt: '2026-08-02T12:00:00.020Z',
      durationMs: 20,
      terminationCause: 'completed',
      counts: {
        total: 3,
        attempted: 3,
        succeeded: 3,
        failed: 0,
        cancelled: 0,
        timedOut: 0,
        skipped: 0,
      },
      warnings: [],
      steps: ['navigate', 'extract', 'fill'].map((stepId, index) => ({
        stepId,
        stepType: stepId,
        status: 'succeeded',
        startedAt: timestamp,
        finishedAt: timestamp,
        durationMs: index,
        ...(stepId === 'extract' || stepId === 'fill'
          ? { locatorKind: stepId === 'extract' ? 'testId' : 'label' }
          : {}),
      })),
      outputs: [
        {
          outputName: 'customerId',
          outputType: 'string',
          producerStepId: 'extract',
          status: 'produced',
        },
      ],
    };
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/complete`)
      .set(leaseHeaders)
      .send({
        schemaVersion: 1,
        clientCompletionId: randomUUID(),
        result: { ...result, outputs: [] },
      })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/complete`)
      .set(leaseHeaders)
      .send({
        schemaVersion: 1,
        clientCompletionId: randomUUID(),
        result,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.run.outputs).toEqual([
          expect.objectContaining({
            outputName: 'customerId',
            status: 'produced',
          }),
        ]);
      });
    expect(
      await prisma.workflowRunOutput.findFirstOrThrow({
        where: { workflowRunId: runId, outputName: 'customerId' },
      }),
    ).toMatchObject({ status: 'PRODUCED' });
  });

  it('creates, authorizes and resolves a safe approval gate idempotently', async () => {
    await request(app.getHttpServer())
      .post('/runner/heartbeat')
      .set(runnerAuth())
      .send({
        schemaVersion: 1,
        runnerVersion: runnerSoftwareIdentity.version,
        softwareIdentity: runnerSoftwareIdentity,
        capabilities: [
          'secure_input_envelope_v1',
          'workflow_verification_v1',
          'workflow_extraction_v1',
          'workflow_approval_v1',
        ],
      })
      .expect(200);

    const created = await request(app.getHttpServer())
      .post(`/workflow-versions/${approvalVersionId}/runs`)
      .set(auth(owner))
      .send({ schemaVersion: 1, runnerDeviceId, clientRunId: randomUUID() })
      .expect(200);
    const runId = created.body.run.id as string;
    const claimed = await request(app.getHttpServer())
      .post('/runner/jobs/claim')
      .set(runnerAuth())
      .send({
        schemaVersion: 1,
        runProtocolVersion: 2,
        workflowSchemaVersion: 1,
        workflowEngineSchemaVersion: 1,
        runnerVersion: '0.1.0',
        claimAttemptId: randomUUID(),
      })
      .expect(200);
    expect(claimed.body.job.runId).toBe(runId);
    const leaseHeaders = {
      ...runnerAuth(),
      'X-TaskTwin-Run-Lease': claimed.body.job.leaseToken as string,
    };
    const progressTimestamp = new Date().toISOString();
    const progressEvents = [
      ['run_status_changed', { status: 'pending' }],
      ['run_status_changed', { status: 'validating' }],
      [
        'step_status_changed',
        { stepId: 'navigate', stepType: 'navigate', status: 'pending' },
      ],
      [
        'step_status_changed',
        { stepId: 'approve-wait', stepType: 'approval', status: 'pending' },
      ],
      [
        'step_status_changed',
        { stepId: 'gated-wait', stepType: 'wait', status: 'pending' },
      ],
      ['run_status_changed', { status: 'starting' }],
      ['run_status_changed', { status: 'running' }],
      [
        'step_status_changed',
        { stepId: 'navigate', stepType: 'navigate', status: 'running' },
      ],
      [
        'step_status_changed',
        { stepId: 'navigate', stepType: 'navigate', status: 'succeeded' },
      ],
      [
        'step_status_changed',
        { stepId: 'approve-wait', stepType: 'approval', status: 'running' },
      ],
    ].map(([kind, data], index) => ({
      sequence: index + 1,
      event: {
        executionId: runId,
        timestamp: progressTimestamp,
        kind,
        ...data,
      },
    }));
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/progress`)
      .set(leaseHeaders)
      .send({
        schemaVersion: 1,
        clientBatchId: randomUUID(),
        firstSequence: 1,
        lastSequence: progressEvents.length,
        events: progressEvents,
      })
      .expect(200);
    const clientRequestId = randomUUID();
    const requestBody = {
      clientRequestId,
      approvalStepId: 'approve-wait',
      gatedStepId: 'gated-wait',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const firstRequest = await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/approval-requests`)
      .set(leaseHeaders)
      .send(requestBody)
      .expect(({ body, status }) => {
        expect(status, JSON.stringify(body)).toBe(200);
      });
    const approvalRequestId = firstRequest.body.approvalRequestId as string;
    expect(firstRequest.body).toMatchObject({
      status: 'PENDING',
      idempotent: false,
    });
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/approval-requests`)
      .set(leaseHeaders)
      .send(requestBody)
      .expect(200)
      .expect(({ body }) => {
        expect(body.approvalRequestId).toBe(approvalRequestId);
        expect(body.idempotent).toBe(true);
      });

    await request(app.getHttpServer())
      .get(`/workspaces/${owner.workspace.id}/approval-requests`)
      .set(auth(viewer))
      .expect(200)
      .expect(({ body }) => {
        expect(body.access.canDecide).toBe(false);
        expect(body.requests).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: approvalRequestId,
              workflowRunId: runId,
              status: 'PENDING',
              approvalStep: expect.objectContaining({
                id: 'approve-wait',
              }),
              gatedStep: expect.objectContaining({ id: 'gated-wait' }),
            }),
          ]),
        );
      });
    await request(app.getHttpServer())
      .post(`/approval-requests/${approvalRequestId}/approve`)
      .set(auth(viewer))
      .send({ clientDecisionId: randomUUID() })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/approval-requests/${approvalRequestId}`)
      .set(auth(outsider))
      .expect(404);

    const clientDecisionId = randomUUID();
    const decisionBody = { clientDecisionId };
    await request(app.getHttpServer())
      .post(`/approval-requests/${approvalRequestId}/approve`)
      .set(auth(owner))
      .send(decisionBody)
      .expect(200)
      .expect(({ body }) => {
        expect(body.idempotent).toBe(false);
        expect(body.request.status).toBe('APPROVED');
      });
    await request(app.getHttpServer())
      .post(`/approval-requests/${approvalRequestId}/approve`)
      .set(auth(owner))
      .send(decisionBody)
      .expect(200)
      .expect(({ body }) => expect(body.idempotent).toBe(true));
    await request(app.getHttpServer())
      .get(`/runner/jobs/${runId}/approval-requests/${approvalRequestId}`)
      .set(leaseHeaders)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('APPROVED'));

    const stored = await prisma.workflowApprovalRequest.findUniqueOrThrow({
      where: { id: approvalRequestId },
    });
    expect(stored).toMatchObject({
      workflowRunId: runId,
      runnerDeviceId,
      approvalStepId: 'approve-wait',
      gatedStepId: 'gated-wait',
      status: 'APPROVED',
    });
    expect(Object.keys(stored)).not.toEqual(
      expect.arrayContaining(['message', 'runtimeInputs', 'secrets', 'url']),
    );

    const timestamp = new Date().toISOString();
    const result = {
      schemaVersion: 1,
      executionId: runId,
      workflowId: approvalWorkflowId,
      workflowVersion: 1,
      status: 'succeeded',
      startedAt: timestamp,
      finishedAt: timestamp,
      durationMs: 0,
      terminationCause: 'completed',
      counts: {
        total: 3,
        attempted: 3,
        succeeded: 3,
        failed: 0,
        cancelled: 0,
        timedOut: 0,
        skipped: 0,
      },
      warnings: [],
      steps: [
        { stepId: 'navigate', stepType: 'navigate' },
        { stepId: 'approve-wait', stepType: 'approval' },
        { stepId: 'gated-wait', stepType: 'wait' },
      ].map((step) => ({
        ...step,
        status: 'succeeded',
        startedAt: timestamp,
        finishedAt: timestamp,
        durationMs: 0,
      })),
      outputs: [],
    };
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/complete`)
      .set(leaseHeaders)
      .send({ schemaVersion: 1, clientCompletionId: randomUUID(), result })
      .expect(200)
      .expect(({ body }) => expect(body.run.status).toBe('SUCCEEDED'));
  });

  it('persists safe attempts and resolves manual repair idempotently', async () => {
    await request(app.getHttpServer())
      .post('/runner/heartbeat')
      .set(runnerAuth())
      .send({
        schemaVersion: 1,
        runnerVersion: runnerSoftwareIdentity.version,
        softwareIdentity: runnerSoftwareIdentity,
        capabilities: [
          'secure_input_envelope_v1',
          'workflow_verification_v1',
          'workflow_extraction_v1',
          'workflow_approval_v1',
          'workflow_manual_repair_v1',
        ],
      })
      .expect(200);

    const created = await request(app.getHttpServer())
      .post(`/workflow-versions/${verificationVersionId}/runs`)
      .set(auth(owner))
      .send({
        schemaVersion: 1,
        runnerDeviceId,
        clientRunId: randomUUID(),
        options: {
          totalTimeoutMs: 120_000,
          stepTimeoutMs: 30_000,
          recoveryMode: 'automatic_safe_and_manual',
        },
      })
      .expect(200);
    const runId = created.body.run.id as string;
    const claimed = await request(app.getHttpServer())
      .post('/runner/jobs/claim')
      .set(runnerAuth())
      .send({
        schemaVersion: 1,
        runProtocolVersion: 2,
        workflowSchemaVersion: 1,
        workflowEngineSchemaVersion: 1,
        runnerVersion: '0.1.0',
        claimAttemptId: randomUUID(),
      })
      .expect(200);
    const leaseHeaders = {
      ...runnerAuth(),
      'X-TaskTwin-Run-Lease': claimed.body.job.leaseToken as string,
    };
    const timestamp = new Date().toISOString();
    const eventData = [
      ['run_status_changed', { status: 'pending' }],
      ['run_status_changed', { status: 'validating' }],
      [
        'step_status_changed',
        { stepId: 'navigate', stepType: 'navigate', status: 'pending' },
      ],
      [
        'step_status_changed',
        { stepId: 'verify-url', stepType: 'verify', status: 'pending' },
      ],
      ['run_status_changed', { status: 'starting' }],
      ['run_status_changed', { status: 'running' }],
      [
        'step_status_changed',
        { stepId: 'navigate', stepType: 'navigate', status: 'running' },
      ],
      [
        'step_status_changed',
        { stepId: 'navigate', stepType: 'navigate', status: 'succeeded' },
      ],
      [
        'step_status_changed',
        { stepId: 'verify-url', stepType: 'verify', status: 'running' },
      ],
      [
        'step_attempt_status_changed',
        {
          stepId: 'verify-url',
          attemptNumber: 1,
          trigger: 'initial',
          status: 'running',
          effectCertainty: 'unknown',
          retryAllowed: false,
        },
      ],
      [
        'step_attempt_status_changed',
        {
          stepId: 'verify-url',
          attemptNumber: 1,
          trigger: 'initial',
          status: 'failed',
          errorCode: 'LOCATOR_NOT_FOUND',
          effectCertainty: 'read_only',
          retryAllowed: true,
        },
      ],
      [
        'step_attempt_status_changed',
        {
          stepId: 'verify-url',
          attemptNumber: 2,
          trigger: 'automatic_retry',
          status: 'running',
          effectCertainty: 'unknown',
          retryAllowed: false,
        },
      ],
      [
        'step_attempt_status_changed',
        {
          stepId: 'verify-url',
          attemptNumber: 2,
          trigger: 'automatic_retry',
          status: 'failed',
          errorCode: 'LOCATOR_NOT_FOUND',
          effectCertainty: 'read_only',
          retryAllowed: true,
        },
      ],
      [
        'step_status_changed',
        {
          stepId: 'verify-url',
          stepType: 'verify',
          status: 'waiting_for_repair',
        },
      ],
      ['run_status_changed', { status: 'waiting_for_repair' }],
    ];
    const events = eventData.map(([kind, data], index) => ({
      sequence: index + 1,
      event: { executionId: runId, timestamp, kind, ...data },
    }));
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/progress`)
      .set(leaseHeaders)
      .send({
        schemaVersion: 1,
        clientBatchId: randomUUID(),
        firstSequence: 1,
        lastSequence: events.length,
        events,
      })
      .expect(200);

    const requestBody = {
      clientRequestId: randomUUID(),
      stepId: 'verify-url',
      attemptNumber: 2,
      safeErrorCode: 'LOCATOR_NOT_FOUND',
      effectCertainty: 'read_only',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const first = await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/repair-requests`)
      .set(leaseHeaders)
      .send(requestBody)
      .expect(200);
    const repairRequestId = first.body.repairRequestId as string;
    expect(first.body).toMatchObject({
      status: 'PENDING',
      retryAllowed: true,
      idempotent: false,
    });
    await request(app.getHttpServer())
      .post(`/runner/jobs/${runId}/repair-requests`)
      .set(leaseHeaders)
      .send(requestBody)
      .expect(200)
      .expect(({ body }) => expect(body.idempotent).toBe(true));

    await request(app.getHttpServer())
      .post(`/repair-requests/${repairRequestId}/retry`)
      .set(auth(viewer))
      .send({ clientDecisionId: randomUUID() })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/repair-requests/${repairRequestId}`)
      .set(auth(outsider))
      .expect(404);

    const decision = { clientDecisionId: randomUUID() };
    await request(app.getHttpServer())
      .post(`/repair-requests/${repairRequestId}/retry`)
      .set(auth(owner))
      .send(decision)
      .expect(200)
      .expect(({ body }) => {
        expect(body.idempotent).toBe(false);
        expect(body.request.status).toBe('RETRY_APPROVED');
      });
    await request(app.getHttpServer())
      .post(`/repair-requests/${repairRequestId}/retry`)
      .set(auth(owner))
      .send(decision)
      .expect(200)
      .expect(({ body }) => expect(body.idempotent).toBe(true));
    await request(app.getHttpServer())
      .get(`/runner/jobs/${runId}/repair-requests/${repairRequestId}`)
      .set(leaseHeaders)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('RETRY_APPROVED'));

    const attempt = await prisma.workflowRunStepAttempt.findFirstOrThrow({
      where: { workflowRunId: runId, attemptNumber: 2 },
    });
    expect(attempt).toMatchObject({
      safeErrorCode: 'LOCATOR_NOT_FOUND',
      effectCertainty: 'READ_ONLY',
      status: 'FAILED',
    });
    expect(JSON.stringify(attempt)).not.toMatch(
      /rawError|runtimeValue|selector|password/i,
    );
  });
});
