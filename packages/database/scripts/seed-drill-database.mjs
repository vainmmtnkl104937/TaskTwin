import { createHmac, randomUUID } from 'node:crypto';

import {
  appendAuditEventTransactional,
  auditHasherForTrail,
  createDatabaseClient,
  getRequiredDatabaseUrl,
  WorkspaceAuditTrailRepository,
} from '../dist/index.js';
import { createAuditSourceId } from '@tasktwin/audit-trail';
import {
  createRunnerReleaseSystemAuditHash,
  RUNNER_RELEASE_SYSTEM_AUDIT_SCOPE,
} from '../dist/runner-release/system-audit-hash.js';

const prisma = createDatabaseClient(getRequiredDatabaseUrl());
const credential = process.env.DRILL_RUNNER_CREDENTIAL;
if (credential === undefined || !/^[A-Za-z0-9_-]{43}$/u.test(credential)) {
  throw new Error('DRILL_RUNNER_CREDENTIAL_REQUIRED');
}
const credentialPepper = process.env.RUNNER_CREDENTIAL_PEPPER;
if (credentialPepper === undefined || credentialPepper.length < 32) {
  throw new Error('DRILL_CREDENTIAL_PEPPER_REQUIRED');
}

try {
  const userId = randomUUID();
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  const pairingSessionId = randomUUID();
  const runnerDeviceId = randomUUID();
  const workflowId = `drill-workflow-${randomUUID()}`;
  const workflowVersionId = randomUUID();
  const workflowRunId = randomUUID();
  const releaseId = randomUUID();
  const rolloutId = randomUUID();
  const alertId = randomUUID();
  const now = new Date();

  await prisma.user.create({
    data: {
      id: userId,
      email: `drill-${userId}@example.test`,
      passwordHash: 'not-a-real-login-hash',
      displayName: 'DR drill operator',
      isSystemAdministrator: true,
    },
  });
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: 'DR Drill',
      slug: `dr-${organizationId}`,
    },
  });
  await prisma.organizationMember.create({
    data: { userId, organizationId, role: 'OWNER' },
  });
  await prisma.workspace.create({
    data: {
      id: workspaceId,
      organizationId,
      name: 'DR Drill Workspace',
      slug: 'dr-drill-workspace',
    },
  });
  await prisma.workspaceAuditChainHead.create({ data: { workspaceId } });
  await prisma.runnerPairingSession.create({
    data: {
      id: pairingSessionId,
      deviceCodeHash: '1'.repeat(64),
      userCodeDigest: '2'.repeat(64),
      status: 'CONSUMED',
      displayName: 'DR drill runner',
      platform: 'linux',
      architecture: 'x64',
      runnerVersion: '0.1.0',
      installationId: randomUUID(),
      expiresAt: new Date(now.getTime() + 3_600_000),
      pollIntervalSeconds: 5,
      workspaceId,
      approvedById: userId,
      approvedAt: now,
      consumedAt: now,
    },
  });
  const pairing = await prisma.runnerPairingSession.findUniqueOrThrow({
    where: { id: pairingSessionId },
  });
  await prisma.runnerDevice.create({
    data: {
      id: runnerDeviceId,
      workspaceId,
      pairingSessionId,
      installationId: pairing.installationId,
      displayName: 'DR drill runner',
      platform: 'linux',
      architecture: 'x64',
      runnerVersion: '0.1.0',
      runProtocolVersion: 1,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
    },
  });
  const credentialHash = createHmac('sha256', credentialPepper)
    .update('credential-auth:v1')
    .update('\0')
    .update(credential)
    .digest('hex');
  await prisma.runnerCredential.create({
    data: { runnerDeviceId, credentialHash },
  });
  await prisma.workflow.create({
    data: {
      id: workflowId,
      workspaceId,
      name: 'DR drill workflow',
    },
  });
  await prisma.workflowVersion.create({
    data: {
      id: workflowVersionId,
      workflowId,
      version: 1,
      status: 'published',
      schemaVersion: 1,
      definition: { schemaVersion: 1, steps: [] },
      publishedAt: now,
      publishedById: userId,
    },
  });
  await prisma.workflowRun.create({
    data: {
      id: workflowRunId,
      workspaceId,
      workflowId,
      workflowVersionId,
      runnerDeviceId,
      createdByUserId: userId,
      clientRunId: randomUUID(),
      status: 'RUNNING',
      runProtocolVersion: 1,
      workflowEngineVersion: 1,
      definitionDigest: '3'.repeat(64),
      allowedOrigins: ['https://example.test'],
      executionOptions: {},
      claimAttemptId: randomUUID(),
      leaseTokenHash: '4'.repeat(64),
      leaseExpiresAt: new Date(now.getTime() - 60_000),
      claimedAt: new Date(now.getTime() - 120_000),
      startedAt: new Date(now.getTime() - 110_000),
    },
  });
  await appendAuditEventTransactional(
    prisma,
    new WorkspaceAuditTrailRepository(prisma),
    {
      workspaceId,
      eventType: 'workflow_run.created',
      actor: { type: 'user', userId },
      primaryEntity: { kind: 'workflow_run', id: workflowRunId },
      occurredAt: now,
      sourceId: createAuditSourceId(
        'drill_seed',
        [workflowRunId],
        auditHasherForTrail,
      ),
      payload: {
        workflowRunId,
        workflowId,
        workflowVersionId,
        runnerDeviceId,
        workflowDigest: '3'.repeat(64),
        policyVersionId: randomUUID(),
        policyDigest: '5'.repeat(64),
      },
    },
  );

  await prisma.runnerRelease.create({
    data: {
      id: releaseId,
      product: 'tasktwin-runner',
      version: '0.1.0',
      manifestDigest: '6'.repeat(64),
      manifest: {
        schemaVersion: 1,
        product: 'tasktwin-runner',
        version: '0.1.0',
      },
      signingKeyId: 'drill-public-key',
      sourceCommit: '7'.repeat(40),
      builtAt: now,
      importedByUserId: userId,
    },
  });
  const systemPayload = {
    releaseId,
    product: 'tasktwin-runner',
    version: '0.1.0',
    manifestDigest: '6'.repeat(64),
  };
  const systemHash = createRunnerReleaseSystemAuditHash({
    scope: RUNNER_RELEASE_SYSTEM_AUDIT_SCOPE,
    sequence: 1,
    eventType: 'runner.release.imported',
    actorUserId: userId,
    releaseId,
    occurredAt: now,
    sourceId: 'drill-release-imported',
    payload: systemPayload,
    previousHash: '0'.repeat(64),
  });
  await prisma.systemAuditChainHead.create({
    data: {
      scope: RUNNER_RELEASE_SYSTEM_AUDIT_SCOPE,
      lastSequence: 1,
      lastEventHash: systemHash.eventHash,
    },
  });
  await prisma.systemAuditEvent.create({
    data: {
      scope: RUNNER_RELEASE_SYSTEM_AUDIT_SCOPE,
      sequence: 1,
      eventType: 'runner.release.imported',
      actorUserId: userId,
      primaryEntityKind: 'runner_release',
      primaryEntityId: releaseId,
      occurredAt: now,
      sourceId: 'drill-release-imported',
      payload: systemPayload,
      payloadDigest: systemHash.payloadDigest,
      previousHash: '0'.repeat(64),
      eventHash: systemHash.eventHash,
    },
  });
  await prisma.runnerReleaseRollout.create({
    data: {
      id: rolloutId,
      workspaceId,
      targetReleaseId: releaseId,
      clientRolloutId: randomUUID(),
      requestDigest: '8'.repeat(64),
      status: 'paused',
      reviewReason: 'drill_fixture',
      createdByUserId: userId,
    },
  });
  await prisma.operationalAlert.create({
    data: {
      id: alertId,
      workspaceId,
      type: 'run_interrupted',
      severity: 'critical',
      status: 'active',
      sourceType: 'workflow_run',
      sourceId: workflowRunId,
      contractDigest: '9'.repeat(64),
      primaryEntityType: 'workflow_run',
      primaryEntityId: workflowRunId,
      relatedEntities: [],
      templateKey: 'run_interrupted.v1',
      templateVersion: 1,
      templateParameters: {
        schemaVersion: 1,
        templateKey: 'run_interrupted.v1',
        workflowRunId,
        interruptedAt: now.toISOString(),
      },
      actionTarget: {
        schemaVersion: 1,
        kind: 'run',
        workspaceId,
        workflowRunId,
      },
    },
  });
  await prisma.notificationOutboxMessage.create({
    data: {
      workspaceId,
      alertId,
      recipientUserId: userId,
      deduplicationKey: `drill:${alertId}:${userId}`,
    },
  });

  console.log(
    JSON.stringify({ workspaceId, runnerDeviceId, workflowRunId, rolloutId }),
  );
} finally {
  await prisma.$disconnect();
}
