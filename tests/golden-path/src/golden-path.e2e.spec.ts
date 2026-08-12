import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createDatabaseClient,
  getRequiredDatabaseUrl,
  WorkflowScheduleRepository,
  type PrismaClient,
} from '@tasktwin/database';
import {
  RecordingArtifactSchema,
  type RecordingArtifact,
} from '@tasktwin/recording-schema';
import { RUN_PROTOCOL_VERSION } from '@tasktwin/run-protocol';
import { RunInputPreparationMetadataSchema } from '@tasktwin/secure-run-inputs';
import {
  StoredRunnerCredentialSchema,
  type StoredRunnerCredential,
  type RunnerCapability,
} from '@tasktwin/runner-protocol';
import {
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
} from '@tasktwin/workflow-schema';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../../apps/api/src/app.module.js';
import { configureApplication } from '../../../apps/api/src/config/configure-application.js';
import { ChromeLocalRecordingArchive } from '../../../apps/extension/src/recording-artifacts/archive-store.js';
import { RecordingSyncController } from '../../../apps/extension/src/recording-artifacts/sync-controller.js';
import { HttpRunnerControlPlaneTransport } from '../../../apps/local-runner/src/control-plane-client.js';
import type { BrowserSessionFactory } from '../../../apps/local-runner/src/execution/browser-session.js';
import { PlaywrightBrowserSessionFactory } from '../../../apps/local-runner/src/execution/playwright-browser-session.js';
import { RunJobWorker } from '../../../apps/local-runner/src/job-dispatch/run-job-worker.js';
import { systemClock } from '../../../apps/local-runner/src/runner-service.js';
import { InMemoryRunnerEncryptionKeyStore } from '../../../apps/local-runner/src/secure-inputs/runner-encryption-key-store.js';
import { RunnerKeyManager } from '../../../apps/local-runner/src/secure-inputs/runner-key-manager.js';
import { FileLocalSecretVaultStore } from '../../../apps/local-runner/src/secrets/local-secret-vault-store.js';
import { LocalSecretVaultService } from '../../../apps/local-runner/src/secrets/local-secret-vault-service.js';
import { LocalVaultSecretProvider } from '../../../apps/local-runner/src/secrets/local-vault-secret-provider.js';
import { NodeScryptMasterKeyProtector } from '../../../apps/local-runner/src/secrets/node-secret-crypto.js';
import { encryptRunInputs } from '../../../apps/web/components/workflow-runs/encrypt-run-inputs.js';
import { InAppNotificationDeliveryProvider } from '../../../apps/notification-worker/src/in-app-delivery.provider.js';
import { NotificationOutboxStore } from '../../../apps/notification-worker/src/outbox-store.js';
import { NotificationWorker } from '../../../apps/notification-worker/src/worker.js';

import {
  GoldenApiClient,
  GoldenApiError,
  numberField,
  object,
  stringField,
} from './support/api-client.js';
import {
  startGoldenFixtureServer,
  type GoldenFixtureServer,
} from './support/fixture-server.js';
import { MemoryRecordingStorage } from './support/memory-storage.js';
import { waitFor } from './support/poll.js';
import { ApiRecordingSyncTransport } from './support/recording-transport.js';
import {
  startGoldenWebProcess,
  type GoldenWebProcess,
} from './support/web-process.js';

const PASSWORD = 'Golden path owner password';
const RUNTIME_CANARY = 'runtime-golden-39@example.test';
const SECRET_CANARY = 'LOCAL_SECRET_GOLDEN_39_ONLY';
const OUTPUT_CANARY = 'GOLDEN_EPHEMERAL_OUTPUT';
const SECRET_ALIAS = 'accountPassword';
const RUNNER_VERSION = '0.1.0';
const CAPABILITIES: RunnerCapability[] = [
  'secure_input_envelope_v1',
  'interactive_secret_prompt_v1',
  'workflow_verification_v1',
  'workflow_extraction_v1',
  'workflow_approval_v1',
  'workflow_manual_repair_v1',
  'scheduled_execution_v1',
  'local_secret_store_v1',
  'runner_service_v1',
  'os_native_secret_unlock_v1',
];

interface Identity {
  readonly accessToken: string;
  readonly userId: string;
  readonly workspaceId: string;
}

interface VersionIdentity {
  readonly workflowId: string;
  readonly versionId: string;
  readonly version: number;
  readonly revision: number;
}

describe.sequential('TaskTwin V1 full-system golden path', () => {
  let app: INestApplication;
  let api: GoldenApiClient;
  let prisma: PrismaClient;
  let fixture: GoldenFixtureServer;
  let web: GoldenWebProcess;
  let apiPort: number;
  let temporaryRoot: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TASKTWIN_E2E_DATABASE_URL ?? getRequiredDatabaseUrl();
    prisma = createDatabaseClient(getRequiredDatabaseUrl());
    await prisma.$connect();
    ({ app, port: apiPort } = await startApi());
    api = new GoldenApiClient(`http://127.0.0.1:${apiPort}`);
    fixture = await startGoldenFixtureServer();
    temporaryRoot = await mkdtemp(join(tmpdir(), 'tasktwin-golden-path-'));
    web = await startGoldenWebProcess(api.origin);
    activePrisma = prisma;
  });

  afterAll(async () => {
    await web?.close().catch(() => undefined);
    await fixture?.close().catch(() => undefined);
    await app?.close().catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
    activePrisma = undefined;
    if (temporaryRoot !== undefined) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('records, publishes, executes, governs, recovers and verifies without leaking values', async () => {
    const identity = await registerOwner(api);
    const ownerApi = api.authenticated(identity.accessToken);
    await verifyWebLogin(web.origin, identity);

    const credential = await pairRunner(api, ownerApi, identity.workspaceId);
    const transport = new HttpRunnerControlPlaneTransport();
    const keyManager = new RunnerKeyManager(
      new InMemoryRunnerEncryptionKeyStore(),
      transport,
    );
    await keyManager.ensureRegistered(credential);

    const vaultStore = new FileLocalSecretVaultStore(temporaryRoot);
    const vault = new LocalSecretVaultService(
      vaultStore,
      new NodeScryptMasterKeyProtector(),
    );
    const passphrase = Buffer.from('golden-path-local-vault-passphrase');
    await vault.initialize({
      workspaceId: identity.workspaceId,
      runnerDeviceId: credential.runnerDeviceId,
      passphrase,
    });
    await vault.setSecret({
      alias: SECRET_ALIAS,
      plaintext: SECRET_CANARY,
      passphrase,
    });
    passphrase.fill(0);
    const inventory = await vault.inventory();
    const synchronized = await transport.synchronizeSecretInventory(
      credential,
      inventory,
    );
    const inventoryPin = {
      schemaVersion: 1 as const,
      vaultId: synchronized.vaultId,
      vaultRevision: synchronized.vaultRevision,
      inventoryDigest: synchronized.inventoryDigest,
    };
    vault.markSynchronized(inventoryPin);
    const localSecrets = new LocalVaultSecretProvider(vault);
    localSecrets.setExpectedPin(inventoryPin);
    await transport.heartbeat(
      credential,
      RUNNER_VERSION,
      CAPABILITIES,
      {
        schemaVersion: 1,
        runtimeMode: 'service',
        autonomyLevel: 'boot_resilient',
        serviceStatus: 'running',
        secretUnlockMode: 'os_native',
        restartResilient: true,
      },
      runnerSoftwareIdentity(),
    );

    const recorded = await recordAndConvert(
      ownerApi,
      identity.workspaceId,
      fixture.origin,
    );
    const published = await editAndPublish(ownerApi, recorded, fixture.origin);
    await expectPublishedImmutable(ownerApi, published, fixture.origin);

    fixture.reset();
    fixture.expectValues(RUNTIME_CANARY, SECRET_CANARY);
    const manualRunId = await createEncryptedRun({
      api: ownerApi,
      versionId: published.versionId,
      runnerDeviceId: credential.runnerDeviceId,
      runtimeValue: RUNTIME_CANARY,
      recoveryMode: 'automatic_safe_and_manual',
    });
    const runnerOutput: string[] = [];
    const approvalRun = runWorker({
      transport,
      credential,
      keyManager,
      localSecrets,
      inventoryPin,
      output: runnerOutput,
    });
    let approval;
    try {
      approval = await waitFor({
        description: 'manual-run approval request',
        inspect: async () =>
          prisma.workflowApprovalRequest.findFirst({
            where: { workflowRunId: manualRunId, status: 'PENDING' },
            select: { id: true },
          }),
      });
    } catch (error: unknown) {
      const diagnostic = await prisma.workflowRun.findUnique({
        where: { id: manualRunId },
        select: {
          status: true,
          terminationCause: true,
          steps: {
            orderBy: { sourceStepIndex: 'asc' },
            select: {
              sourceStepIndex: true,
              stepType: true,
              status: true,
              errorCode: true,
            },
          },
          repairRequests: {
            select: { stepIndex: true, status: true, safeErrorCode: true },
          },
        },
      });
      throw new Error(
        `Manual approval was not reached: ${JSON.stringify({ diagnostic, runnerOutput })}`,
        { cause: error },
      );
    }
    await decideApprovalThroughWeb(
      web.origin,
      identity.workspaceId,
      approval.id,
      'Approve',
    );
    await waitForTerminalRun(prisma, manualRunId, 'SUCCEEDED');
    await approvalRun.stop();
    expect(fixture.snapshot()).toMatchObject({
      submitted: true,
      runtimeMatched: true,
      secretMatched: true,
      submitCount: 1,
    });

    fixture.reset();
    fixture.expectValues(RUNTIME_CANARY, SECRET_CANARY);
    const rejectedRunId = await createEncryptedRun({
      api: ownerApi,
      versionId: published.versionId,
      runnerDeviceId: credential.runnerDeviceId,
      runtimeValue: RUNTIME_CANARY,
      recoveryMode: 'automatic_safe_and_manual',
    });
    const rejectedRun = runWorker({
      transport,
      credential,
      keyManager,
      localSecrets,
      inventoryPin,
      output: runnerOutput,
    });
    const rejection = await waitFor({
      description: 'reject-path approval request',
      inspect: async () =>
        prisma.workflowApprovalRequest.findFirst({
          where: { workflowRunId: rejectedRunId, status: 'PENDING' },
          select: { id: true },
        }),
    });
    await decideApprovalThroughWeb(
      web.origin,
      identity.workspaceId,
      rejection.id,
      'Reject',
    );
    await waitForTerminalRun(prisma, rejectedRunId, 'CANCELLED');
    await rejectedRun.stop();
    expect(fixture.snapshot().submitted).toBe(false);
    expect(fixture.snapshot().submitCount).toBe(0);

    const repairVersion = await cloneEditAndPublish(
      ownerApi,
      published,
      repairDefinition(
        published.workflowId,
        published.version + 1,
        fixture.origin,
      ),
    );
    fixture.reset();
    const repairRunResponse = object(
      await ownerApi.post(
        `/workflow-versions/${repairVersion.versionId}/runs`,
        {
          schemaVersion: 1,
          runnerDeviceId: credential.runnerDeviceId,
          clientRunId: randomUUID(),
          options: {
            totalTimeoutMs: 60_000,
            stepTimeoutMs: 5_000,
            recoveryMode: 'automatic_safe_and_manual',
          },
        },
      ),
      'repair run response',
    );
    const repairRunId = stringField(
      object(repairRunResponse.run, 'repair run'),
      'id',
    );
    const repairing = runWorker({
      transport,
      credential,
      keyManager,
      localSecrets,
      inventoryPin,
      output: runnerOutput,
    });
    const repair = await waitFor({
      description: 'manual repair request',
      timeoutMs: 30_000,
      inspect: async () =>
        prisma.workflowRepairRequest.findFirst({
          where: { workflowRunId: repairRunId, status: 'PENDING' },
          select: { id: true },
        }),
    });
    fixture.allowRepair();
    await decideRepairThroughWeb(web.origin, identity.workspaceId, repair.id);
    await waitForTerminalRun(prisma, repairRunId, 'SUCCEEDED');
    await repairing.stop();
    expect(fixture.snapshot().repairCompleted).toBe(true);

    const scheduledVersion = await cloneEditAndPublish(
      ownerApi,
      repairVersion,
      scheduledSecretDefinition(
        published.workflowId,
        repairVersion.version + 1,
        fixture.origin,
      ),
    );
    fixture.reset();
    fixture.expectValues(null, SECRET_CANARY);
    const schedule = await createDueSchedule(
      ownerApi,
      scheduledVersion.versionId,
      credential.runnerDeviceId,
    );
    const persistedSchedule = await prisma.workflowSchedule.findUniqueOrThrow({
      where: { id: schedule },
      select: { nextOccurrenceAt: true },
    });
    expect(persistedSchedule.nextOccurrenceAt).not.toBeNull();
    await transport.heartbeat(
      credential,
      RUNNER_VERSION,
      CAPABILITIES,
      undefined,
      runnerSoftwareIdentity(),
    );
    await new WorkflowScheduleRepository(prisma).processOccurrence({
      scheduleId: schedule,
      now: persistedSchedule.nextOccurrenceAt!,
    });
    const occurrence = await prisma.workflowScheduleOccurrence.findFirstOrThrow(
      {
        where: { scheduleId: schedule },
        select: { workflowRunId: true },
      },
    );
    expect(occurrence.workflowRunId).not.toBeNull();
    const scheduledRun = runWorker({
      transport,
      credential,
      keyManager,
      localSecrets,
      inventoryPin,
      output: runnerOutput,
    });
    await waitForTerminalRun(prisma, occurrence.workflowRunId!, 'SUCCEEDED');
    await scheduledRun.stop();
    expect(fixture.snapshot()).toMatchObject({
      submitted: true,
      secretMatched: true,
      submitCount: 1,
    });
    expect(
      await prisma.workflowScheduleOccurrence.count({
        where: { scheduleId: schedule },
      }),
    ).toBe(1);

    const notificationWorker = new NotificationWorker(
      `golden-${randomUUID()}`,
      new NotificationOutboxStore(prisma),
      new InAppNotificationDeliveryProvider(prisma),
    );
    await notificationWorker.runOnce();
    await notificationWorker.runOnce();
    const notifications = object(
      await ownerApi.get('/me/notifications?limit=100'),
      'notification list',
    );
    expect(Array.isArray(notifications.items)).toBe(true);
    expect((notifications.items as unknown[]).length).toBeGreaterThan(0);

    const audit = object(
      await ownerApi.post(
        `/workspaces/${identity.workspaceId}/audit-trail/verify`,
        { sampleLimit: 200 },
      ),
      'audit verification',
    );
    expect(audit.status, JSON.stringify(audit)).toBe('ok');
    expect(numberField(audit, 'checkedCount')).toBeGreaterThan(0);

    await verifyRunnerReconnect(credential, transport);
    const vaultFile = await readFile(vaultStore.filePath, 'utf8');
    const sensitiveValues = [RUNTIME_CANARY, SECRET_CANARY, OUTPUT_CANARY];
    expect(vaultFile).not.toContain(SECRET_CANARY);
    const unsafeTables = await databaseTablesContaining(
      prisma,
      sensitiveValues,
    );
    expect(unsafeTables).toEqual([]);
    const auditRows = await prisma.workspaceAuditEvent.findMany({
      where: { workspaceId: identity.workspaceId },
      select: { payload: true },
    });
    const notificationRows = await prisma.userNotification.findMany({
      where: { workspaceId: identity.workspaceId },
    });
    const safeSurfaces = JSON.stringify({
      runnerOutput,
      webLogs: web.logs,
      auditRows,
      notificationRows,
    });
    for (const value of sensitiveValues)
      expect(safeSurfaces).not.toContain(value);
  });

  async function verifyRunnerReconnect(
    credential: StoredRunnerCredential,
    transport: HttpRunnerControlPlaneTransport,
  ): Promise<void> {
    await app.close();
    await expect(
      transport.heartbeat(
        credential,
        RUNNER_VERSION,
        CAPABILITIES,
        undefined,
        runnerSoftwareIdentity(),
      ),
    ).rejects.toMatchObject({ status: null });
    ({ app } = await startApi(apiPort));
    await expect(
      transport.heartbeat(
        credential,
        RUNNER_VERSION,
        CAPABILITIES,
        undefined,
        runnerSoftwareIdentity(),
      ),
    ).resolves.toMatchObject({
      response: { runnerDeviceId: credential.runnerDeviceId },
    });
  }
});

function runnerSoftwareIdentity() {
  return {
    product: 'tasktwin-runner' as const,
    version: RUNNER_VERSION,
    runnerProtocolVersion: RUN_PROTOCOL_VERSION,
    workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
    localStateSchemaVersion: 1,
    platform:
      process.platform === 'darwin'
        ? ('macos' as const)
        : process.platform === 'win32'
          ? ('windows' as const)
          : ('linux' as const),
    architecture:
      process.arch === 'arm64' ? ('arm64' as const) : ('x64' as const),
  };
}

async function startApi(
  port = 0,
): Promise<{ app: INestApplication; port: number }> {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  configureApplication(app);
  await app.listen(port, '127.0.0.1');
  const address = (app.getHttpServer() as Server).address();
  if (address === null || typeof address === 'string') {
    await app.close();
    throw new Error('The E2E API did not bind to loopback.');
  }
  return { app, port: address.port };
}

async function registerOwner(api: GoldenApiClient): Promise<Identity> {
  const response = object(
    await api.post('/auth/register', {
      email: `golden-${randomUUID()}@example.test`,
      password: PASSWORD,
      displayName: 'Golden Path Owner',
      organizationName: 'Golden Path Organization',
    }),
    'registration response',
  );
  return {
    accessToken: stringField(response, 'accessToken'),
    userId: stringField(object(response.user, 'registered user'), 'id'),
    workspaceId: stringField(object(response.workspace, 'workspace'), 'id'),
  };
}

async function verifyWebLogin(
  origin: string,
  identity: Identity,
): Promise<void> {
  const context = await chromium.launch({ headless: true });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/login`);
    await page
      .getByLabel('Email')
      .fill((await fetchIdentityEmail(identity.userId)) ?? '');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/workspaces', { timeout: 15_000 });
    await page.getByRole('heading', { name: 'Workspaces' }).waitFor();
  } finally {
    await context.close();
  }
}

async function fetchIdentityEmail(userId: string): Promise<string | null> {
  const record = await globalPrisma().user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return record?.email ?? null;
}

let activePrisma: PrismaClient | undefined;
function globalPrisma(): PrismaClient {
  if (activePrisma === undefined) {
    throw new Error('The golden-path database is not initialized.');
  }
  return activePrisma;
}

async function pairRunner(
  api: GoldenApiClient,
  ownerApi: GoldenApiClient,
  workspaceId: string,
): Promise<StoredRunnerCredential> {
  const installationId = randomUUID();
  const created = object(
    await api.post('/runner-pairing/sessions', {
      schemaVersion: 1,
      metadata: {
        displayName: 'Golden Path Runner',
        platform:
          process.platform === 'darwin'
            ? 'darwin'
            : process.platform === 'win32'
              ? 'win32'
              : 'linux',
        architecture: process.arch === 'arm64' ? 'arm64' : 'x64',
        runnerVersion: RUNNER_VERSION,
        installationId,
      },
    }),
    'pairing session',
  );
  const userCode = stringField(created, 'userCode');
  await ownerApi.post(`/workspaces/${workspaceId}/runner-pairing/approve`, {
    schemaVersion: 1,
    userCode,
  });
  const paired = object(
    await api.post('/runner-pairing/token', {
      schemaVersion: 1,
      deviceCode: stringField(created, 'deviceCode'),
    }),
    'pairing token',
  );
  expect(paired.status).toBe('paired');
  return StoredRunnerCredentialSchema.parse({
    schemaVersion: 1,
    controlPlaneOrigin: api.origin,
    runnerDeviceId: stringField(paired, 'runnerDeviceId'),
    workspaceId: stringField(paired, 'workspaceId'),
    installationId,
    credential: stringField(paired, 'credential'),
    savedAt: new Date().toISOString(),
  });
}

async function recordAndConvert(
  api: GoldenApiClient,
  workspaceId: string,
  origin: string,
): Promise<VersionIdentity> {
  const artifact = await goldenRecordingArtifact(origin);
  const archive = new ChromeLocalRecordingArchive(new MemoryRecordingStorage());
  const now = new Date().toISOString();
  await archive.finalize(artifact, now);
  const synced = await new RecordingSyncController(
    archive,
    new ApiRecordingSyncTransport(api, workspaceId),
    { now: () => new Date().toISOString() },
  ).sync(artifact.clientSessionId);
  expect(synced.status).toBe('synced');
  if (synced.remoteSessionId === null)
    throw new Error('Recording did not sync.');
  const conversion = object(
    await api.post(
      `/recording-sessions/${synced.remoteSessionId}/workflow-drafts`,
      {
        clientConversionId: randomUUID(),
        name: 'Golden recorded workflow',
        description: 'Deterministic local fixture golden path.',
      },
    ),
    'recording conversion',
  );
  expect(conversion.status).toBe('draft');
  return {
    workflowId: stringField(conversion, 'workflowId'),
    versionId: stringField(conversion, 'workflowVersionId'),
    version: numberField(conversion, 'version'),
    revision: 1,
  };
}

async function goldenRecordingArtifact(
  origin: string,
): Promise<RecordingArtifact> {
  const sourcePath = new URL(
    '../../../packages/recording-schema/fixtures/valid-recording-artifact.v1.json',
    import.meta.url,
  );
  const source = JSON.parse(await readFile(sourcePath, 'utf8')) as Record<
    string,
    unknown
  >;
  const sessionId = randomUUID();
  const events = (source.events as Array<Record<string, unknown>>).map(
    (event, index) => ({
      ...event,
      eventId: randomUUID(),
      sessionId,
      sequence: index + 1,
      origin,
    }),
  );
  return RecordingArtifactSchema.parse({
    ...source,
    clientSessionId: sessionId,
    targetOrigin: origin,
    events,
  });
}

async function editAndPublish(
  api: GoldenApiClient,
  identity: VersionIdentity,
  origin: string,
): Promise<VersionIdentity> {
  return saveAndPublish(
    api,
    identity,
    manualDefinition(identity.workflowId, identity.version, origin),
  );
}

async function cloneEditAndPublish(
  api: GoldenApiClient,
  source: VersionIdentity,
  definition: WorkflowDefinition,
): Promise<VersionIdentity> {
  const created = object(
    await api.post(`/workflows/${source.workflowId}/versions`, {
      sourceVersionId: source.versionId,
      clientCreationId: randomUUID(),
    }),
    'draft clone',
  );
  const version = object(created.workflowVersion, 'cloned workflow version');
  const identity = {
    workflowId: source.workflowId,
    versionId: stringField(version, 'id'),
    version: numberField(version, 'version'),
    revision: numberField(version, 'revision'),
  };
  expect(definition.version).toBe(identity.version);
  return saveAndPublish(api, identity, definition);
}

async function saveAndPublish(
  api: GoldenApiClient,
  identity: VersionIdentity,
  definition: WorkflowDefinition,
): Promise<VersionIdentity> {
  const saved = object(
    await api.patch(`/workflow-versions/${identity.versionId}/draft`, {
      expectedRevision: identity.revision,
      definition,
    }),
    'saved workflow',
  );
  const savedVersion = object(saved.workflowVersion, 'saved workflow version');
  const submitted = object(
    await api.post(
      `/workflow-versions/${identity.versionId}/submit-for-testing`,
      { expectedRevision: numberField(savedVersion, 'revision') },
    ),
    'testing workflow',
  );
  const testing = object(submitted.workflowVersion, 'testing version');
  const published = object(
    await api.post(`/workflow-versions/${identity.versionId}/publish`, {
      expectedRevision: numberField(testing, 'revision'),
    }),
    'published workflow',
  );
  const version = object(published.workflowVersion, 'published version');
  expect(version.status).toBe('published');
  return {
    workflowId: identity.workflowId,
    versionId: identity.versionId,
    version: numberField(version, 'version'),
    revision: numberField(version, 'revision'),
  };
}

async function expectPublishedImmutable(
  api: GoldenApiClient,
  identity: VersionIdentity,
  origin: string,
): Promise<void> {
  await expect(
    api.patch(`/workflow-versions/${identity.versionId}/draft`, {
      expectedRevision: identity.revision,
      definition: manualDefinition(
        identity.workflowId,
        identity.version,
        origin,
      ),
    }),
  ).rejects.toBeInstanceOf(GoldenApiError);
}

function manualDefinition(
  workflowId: string,
  version: number,
  origin: string,
): WorkflowDefinition {
  return WorkflowDefinitionSchema.parse({
    schemaVersion: 1,
    workflowId,
    version,
    name: 'Golden manual workflow',
    description: 'Runtime variable, local secret, output, approval and verify.',
    status: 'draft',
    variables: [{ name: 'contactEmail', valueType: 'string', required: true }],
    steps: [
      {
        id: 'navigate',
        type: 'navigate',
        name: 'Open fixture',
        url: { kind: 'literal', value: origin },
      },
      {
        id: 'open',
        type: 'click',
        name: 'Open form',
        locator: { kind: 'testId', value: 'record-save' },
        actionIntent: 'change_state',
      },
      {
        id: 'runtime',
        type: 'fill',
        name: 'Fill runtime value',
        locator: { kind: 'testId', value: 'record-email' },
        value: { kind: 'variable', variableName: 'contactEmail' },
      },
      {
        id: 'secret',
        type: 'fill',
        name: 'Fill local secret',
        locator: { kind: 'testId', value: 'record-password' },
        value: { kind: 'secret', secretName: SECRET_ALIAS },
      },
      {
        id: 'output',
        type: 'extract',
        name: 'Extract ephemeral output',
        locator: { kind: 'testId', value: 'ephemeral-output' },
        source: { kind: 'text' },
        outputName: 'ephemeralResult',
        outputLabel: 'Ephemeral result',
        retention: 'ephemeral',
        timeoutMs: 5_000,
      },
      {
        id: 'approval',
        type: 'approval',
        name: 'Approve submit',
        message: 'Approve the fixture submission.',
        riskLevel: 'medium',
        scope: 'next_step',
        timeoutMs: 30_000,
      },
      {
        id: 'submit',
        type: 'click',
        name: 'Submit fixture',
        locator: { kind: 'testId', value: 'submit-fixture' },
        actionIntent: 'submit',
      },
      {
        id: 'wait',
        type: 'wait',
        name: 'Allow fixture response',
        durationMs: 100,
      },
      {
        id: 'verify',
        type: 'verify',
        name: 'Verify completion',
        assertion: {
          kind: 'text',
          locator: { kind: 'testId', value: 'final-result' },
          matchMode: 'exact',
          expected: { kind: 'literal', value: 'Fixture completed' },
        },
        timeoutMs: 5_000,
      },
    ],
  });
}

function repairDefinition(
  workflowId: string,
  version: number,
  origin: string,
): WorkflowDefinition {
  return WorkflowDefinitionSchema.parse({
    schemaVersion: 1,
    workflowId,
    version,
    name: 'Golden manual repair workflow',
    status: 'draft',
    variables: [],
    steps: [
      {
        id: 'navigate-repair',
        type: 'navigate',
        name: 'Open repair fixture',
        url: { kind: 'literal', value: origin },
      },
      {
        id: 'repair-target',
        type: 'click',
        name: 'Click repaired target',
        locator: { kind: 'testId', value: 'repair-target' },
        actionIntent: 'change_state',
      },
      {
        id: 'verify-repair',
        type: 'verify',
        name: 'Verify repair',
        assertion: {
          kind: 'text',
          locator: { kind: 'testId', value: 'final-result' },
          matchMode: 'exact',
          expected: { kind: 'literal', value: 'Repair completed' },
        },
        timeoutMs: 5_000,
      },
    ],
  });
}

function scheduledSecretDefinition(
  workflowId: string,
  version: number,
  origin: string,
): WorkflowDefinition {
  return WorkflowDefinitionSchema.parse({
    schemaVersion: 1,
    workflowId,
    version,
    name: 'Golden scheduled secret workflow',
    status: 'draft',
    variables: [],
    steps: [
      {
        id: 'navigate-scheduled',
        type: 'navigate',
        name: 'Open fixture',
        url: { kind: 'literal', value: origin },
      },
      {
        id: 'open-scheduled',
        type: 'click',
        name: 'Open form',
        locator: { kind: 'testId', value: 'record-save' },
        actionIntent: 'change_state',
      },
      {
        id: 'secret-scheduled',
        type: 'fill',
        name: 'Fill local secret',
        locator: { kind: 'testId', value: 'record-password' },
        value: { kind: 'secret', secretName: SECRET_ALIAS },
      },
      {
        id: 'submit-scheduled',
        type: 'click',
        name: 'Submit fixture',
        locator: { kind: 'testId', value: 'submit-fixture' },
        actionIntent: 'change_state',
      },
      {
        id: 'wait-scheduled',
        type: 'wait',
        name: 'Allow fixture response',
        durationMs: 100,
      },
      {
        id: 'verify-scheduled',
        type: 'verify',
        name: 'Verify completion',
        assertion: {
          kind: 'text',
          locator: { kind: 'testId', value: 'final-result' },
          matchMode: 'exact',
          expected: { kind: 'literal', value: 'Fixture completed' },
        },
        timeoutMs: 5_000,
      },
    ],
  });
}

async function createEncryptedRun(input: {
  api: GoldenApiClient;
  versionId: string;
  runnerDeviceId: string;
  runtimeValue: string;
  recoveryMode: 'automatic_safe_and_manual';
}): Promise<string> {
  const preparedResponse = object(
    await input.api.post(
      `/workflow-versions/${input.versionId}/run-preparations`,
      {
        schemaVersion: 1,
        clientPreparationId: randomUUID(),
        clientRunId: randomUUID(),
        runnerDeviceId: input.runnerDeviceId,
        options: {
          totalTimeoutMs: 60_000,
          stepTimeoutMs: 10_000,
          recoveryMode: input.recoveryMode,
        },
      },
    ),
    'run preparation',
  );
  const preparation = RunInputPreparationMetadataSchema.parse(
    preparedResponse.preparation,
  );
  const envelope = await encryptRunInputs(preparation, {
    schemaVersion: 1,
    values: {
      contactEmail: { kind: 'string', value: input.runtimeValue },
    },
  });
  const committed = object(
    await input.api.post(
      `/run-preparations/${preparation.preparationId}/commit`,
      { schemaVersion: 1, envelope },
    ),
    'committed run',
  );
  return stringField(object(committed.run, 'committed workflow run'), 'id');
}

function runWorker(input: {
  transport: HttpRunnerControlPlaneTransport;
  credential: StoredRunnerCredential;
  keyManager: RunnerKeyManager;
  localSecrets: LocalVaultSecretProvider;
  inventoryPin: {
    schemaVersion: 1;
    vaultId: string;
    vaultRevision: number;
    inventoryDigest: string;
  };
  output: string[];
}): { stop(): Promise<void> } {
  const controller = new AbortController();
  const browserSessions: BrowserSessionFactory = {
    create: (options) =>
      new PlaywrightBrowserSessionFactory().create({
        ...options,
        headless: true,
      }),
  };
  const worker = new RunJobWorker(
    input.transport,
    browserSessions,
    systemClock,
    { write: (message) => input.output.push(message) },
    RUNNER_VERSION,
    input.keyManager,
    input.localSecrets,
    { headed: true, attended: true },
    input.localSecrets,
    () => input.inventoryPin,
  );
  const running = worker.runLoop(input.credential, controller.signal);
  return {
    async stop() {
      worker.beginDrain();
      controller.abort();
      await Promise.race([
        running,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Runner did not stop.')), 10_000),
        ),
      ]);
    },
  };
}

async function waitForTerminalRun(
  prisma: PrismaClient,
  runId: string,
  expected: 'SUCCEEDED' | 'CANCELLED',
): Promise<void> {
  let run: { status: string };
  try {
    run = await waitFor({
      description: `${expected} run ${runId}`,
      timeoutMs: 60_000,
      inspect: async () => {
        const current = await prisma.workflowRun.findUnique({
          where: { id: runId },
          select: { status: true },
        });
        return current !== null && TERMINAL_RUN_STATUSES.has(current.status)
          ? current
          : null;
      },
    });
  } catch (error: unknown) {
    const current = await prisma.workflowRun.findUnique({
      where: { id: runId },
      select: {
        status: true,
        terminationCause: true,
        lastProgressSequence: true,
        steps: {
          orderBy: { sourceStepIndex: 'asc' },
          select: { sourceStepIndex: true, status: true, errorCode: true },
        },
      },
    });
    throw new Error(
      `Run did not reach ${expected}: ${JSON.stringify(current)}.`,
      { cause: error },
    );
  }
  if (run.status !== expected) {
    const current = await prisma.workflowRun.findUnique({
      where: { id: runId },
      select: {
        status: true,
        terminationCause: true,
        finalResult: true,
        lastProgressSequence: true,
        steps: {
          orderBy: { sourceStepIndex: 'asc' },
          select: { sourceStepIndex: true, status: true, errorCode: true },
        },
      },
    });
    throw new Error(
      `Run reached ${run.status} instead of ${expected}: ${JSON.stringify({
        ...current,
        finalResult: safeFinalError(current?.finalResult),
      })}.`,
    );
  }
}

const TERMINAL_RUN_STATUSES = new Set([
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
  'INTERRUPTED',
]);

function safeFinalError(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const error = (value as Record<string, unknown>).error;
  if (typeof error !== 'object' || error === null || Array.isArray(error)) {
    return null;
  }
  const code = (error as Record<string, unknown>).code;
  return typeof code === 'string' ? { code } : null;
}

async function decideApprovalThroughWeb(
  webOrigin: string,
  workspaceId: string,
  approvalId: string,
  decision: 'Approve' | 'Reject',
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const user = await globalPrisma().user.findFirstOrThrow({
      where: { displayName: 'Golden Path Owner' },
      select: { email: true },
    });
    await page.goto(`${webOrigin}/login`);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/workspaces');
    page.on('dialog', (dialog) => void dialog.accept());
    await page.goto(
      `${webOrigin}/workspaces/${workspaceId}/approvals/${approvalId}`,
    );
    await page.getByRole('button', { name: decision }).click();
    await waitFor({
      description: `${decision} approval decision`,
      inspect: async () => {
        const row = await globalPrisma().workflowApprovalRequest.findUnique({
          where: { id: approvalId },
          select: { status: true },
        });
        const expected = decision === 'Approve' ? 'APPROVED' : 'REJECTED';
        return row?.status === expected ? true : null;
      },
    });
  } finally {
    await browser.close();
  }
}

async function decideRepairThroughWeb(
  webOrigin: string,
  workspaceId: string,
  repairId: string,
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const user = await globalPrisma().user.findFirstOrThrow({
      where: { displayName: 'Golden Path Owner' },
      select: { email: true },
    });
    await page.goto(`${webOrigin}/login`);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/workspaces');
    page.on('dialog', (dialog) => void dialog.accept());
    await page.goto(
      `${webOrigin}/workspaces/${workspaceId}/repairs/${repairId}`,
    );
    await page.getByRole('button', { name: 'Retry step' }).click();
    await waitFor({
      description: 'manual repair retry decision',
      inspect: async () => {
        const row = await globalPrisma().workflowRepairRequest.findUnique({
          where: { id: repairId },
          select: { status: true },
        });
        return row?.status === 'RETRY_APPROVED' ? true : null;
      },
    });
  } finally {
    await browser.close();
  }
}

async function createDueSchedule(
  api: GoldenApiClient,
  versionId: string,
  runnerDeviceId: string,
): Promise<string> {
  const nextMinute = new Date(Date.now() + 60_000);
  nextMinute.setUTCSeconds(0, 0);
  const date = nextMinute.toISOString().slice(0, 10);
  const time = nextMinute.toISOString().slice(11, 16);
  const response = object(
    await api.post(`/workflow-versions/${versionId}/schedules`, {
      schemaVersion: 1,
      clientScheduleId: randomUUID(),
      name: 'Golden scheduled secret',
      definition: {
        schemaVersion: 1,
        type: 'one_time',
        timezone: 'UTC',
        date,
        time,
      },
      runnerDeviceId,
      maxStartDelaySeconds: 300,
    }),
    'schedule response',
  );
  return stringField(object(response.schedule, 'schedule'), 'id');
}

async function databaseTablesContaining(
  prisma: PrismaClient,
  values: readonly string[],
): Promise<string[]> {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  const unsafe: string[] = [];
  for (const { table_name: table } of tables) {
    if (!/^[A-Za-z0-9_]+$/u.test(table)) continue;
    for (const value of values) {
      const rows = await prisma.$queryRawUnsafe<Array<{ found: boolean }>>(
        `SELECT EXISTS (SELECT 1 FROM "${table}" AS row WHERE to_jsonb(row)::text LIKE $1) AS found`,
        `%${value}%`,
      );
      if (rows[0]?.found === true) {
        unsafe.push(table);
        break;
      }
    }
  }
  return unsafe;
}
