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
const credentialPepper = 'session17-credential-pepper-value-safe';
const leasePepper = 'session17-run-lease-pepper-value-safe';
const pairingPepper = 'session17-pairing-pepper-value-safe-123';

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
  let runnerDeviceId: string;
  let runnerCredential: string;
  const userIds: string[] = [];
  const organizationIds: string[] = [];

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
    userIds.push(identity.user.id);
    organizationIds.push(identity.organization.id);
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
    await prisma.organizationMember.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.workspace.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
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
        runnerVersion: '0.1.0',
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
        runnerVersion: '0.1.0',
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
        runnerVersion: '0.1.0',
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
});
