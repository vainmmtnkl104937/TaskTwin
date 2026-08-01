import {
  constants,
  createCipheriv,
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  randomUUID,
} from 'node:crypto';

import type { StoredRunnerCredential } from '@tasktwin/runner-protocol';
import {
  InMemorySecretProvider,
  PlaintextRunInputPayloadSchema,
  RunInputAdditionalAuthenticatedDataSchema,
  SecureRunInputEnvelopeSchema,
  encodeRunInputAad,
  type RunnerEncryptionKeyRegistrationRequest,
} from '@tasktwin/secure-run-inputs';
import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { afterEach, describe, expect, it } from 'vitest';

import type { RunnerControlPlaneTransport } from '../control-plane-client.js';
import {
  startFixtureServer,
  type RunningFixtureServer,
} from '../execution/fixture-server.js';
import { PlaywrightBrowserSessionFactory } from '../execution/playwright-browser-session.js';
import { LocalWorkflowExecutor } from '../execution/workflow-executor.js';
import { InMemoryRunnerEncryptionKeyStore } from './runner-encryption-key-store.js';
import { RunnerKeyManager } from './runner-key-manager.js';
import { acquireSecureRuntime } from './secure-runtime.js';

const servers: RunningFixtureServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('encrypted runtime input Chromium integration', () => {
  it('decrypts in the Runner and executes without reporting plaintext', async () => {
    const server = await startFixtureServer();
    servers.push(server);
    const runId = randomUUID();
    const runnerDeviceId = randomUUID();
    const workspaceId = randomUUID();
    const workflowVersionId = randomUUID();
    const preparationId = randomUUID();
    const clientRunId = randomUUID();
    const credential: StoredRunnerCredential = {
      schemaVersion: 1,
      controlPlaneOrigin: 'http://127.0.0.1:3001',
      runnerDeviceId,
      workspaceId,
      installationId: randomUUID(),
      credential: 'A'.repeat(43),
      savedAt: new Date().toISOString(),
    };
    const store = new InMemoryRunnerEncryptionKeyStore();
    const keyManager = new RunnerKeyManager(store, {
      registerEncryptionKey: async (
        _credential: StoredRunnerCredential,
        request: RunnerEncryptionKeyRegistrationRequest,
      ) => ({
        schemaVersion: 1,
        idempotent: false,
        key: request.key,
      }),
    } as unknown as RunnerControlPlaneTransport);
    const localKey = await keyManager.ensureRegistered(credential);
    const workflow: WorkflowDefinition = {
      schemaVersion: 1,
      workflowId: 'session18BrowserInput',
      version: 1,
      name: 'Session 18 browser input',
      status: 'published',
      variables: [
        { name: 'customerName', valueType: 'string', required: true },
      ],
      steps: [
        {
          id: 'navigate',
          type: 'navigate',
          name: 'Navigate',
          url: { kind: 'literal', value: server.origin },
        },
        {
          id: 'open',
          type: 'click',
          name: 'Open',
          locator: { kind: 'testId', value: 'open-form' },
        },
        {
          id: 'fill',
          type: 'fill',
          name: 'Fill',
          locator: { kind: 'label', value: 'Customer name', exact: true },
          value: { kind: 'variable', variableName: 'customerName' },
        },
        {
          id: 'select',
          type: 'select',
          name: 'Select',
          locator: { kind: 'label', value: 'Required option', exact: true },
          value: { kind: 'literal', value: 'second' },
        },
        {
          id: 'check',
          type: 'setChecked',
          name: 'Check',
          locator: { kind: 'label', value: 'Confirm fixture', exact: true },
          checked: true,
        },
        {
          id: 'submit',
          type: 'click',
          name: 'Submit',
          locator: {
            kind: 'role',
            role: 'button',
            name: 'Submit fixture',
            exact: true,
          },
        },
        {
          id: 'wait',
          type: 'wait',
          name: 'Allow completion',
          durationMs: 100,
        },
      ],
    };
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const aad = RunInputAdditionalAuthenticatedDataSchema.parse({
      schemaVersion: 1,
      profile: 'secure_input_envelope_v1',
      preparationId,
      workflowRunId: runId,
      workspaceId,
      workflowId: workflow.workflowId,
      workflowVersionId,
      workflowVersion: 1,
      definitionDigest: 'a'.repeat(64),
      runnerDeviceId,
      keyId: localKey.metadata.keyId,
      keyFingerprint: localKey.metadata.fingerprint,
      clientRunId,
      allowedOrigins: [server.origin],
      executionOptions: { totalTimeoutMs: 30_000, stepTimeoutMs: 10_000 },
      expiresAt,
    });
    const safeValue = 'TaskTwin sample';
    const payload = PlaintextRunInputPayloadSchema.parse({
      schemaVersion: 1,
      preparationId,
      workflowRunId: runId,
      workflowVersionId,
      runnerDeviceId,
      keyId: localKey.metadata.keyId,
      expiresAt,
      inputs: {
        schemaVersion: 1,
        values: { customerName: { kind: 'string', value: safeValue } },
      },
    });
    const aadBytes = Buffer.from(encodeRunInputAad(aad));
    const aesKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
    cipher.setAAD(aadBytes);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const publicKey = createPublicKey({
      key: Buffer.from(localKey.metadata.publicKeySpki, 'base64url'),
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
    const manifest = {
      schemaVersion: 1 as const,
      variables: [
        {
          name: 'customerName',
          valueType: 'string' as const,
          required: true,
          requiredForRun: true,
          usageCount: 1,
        },
      ],
      secrets: [],
    };
    const envelope = SecureRunInputEnvelopeSchema.parse({
      schemaVersion: 1,
      profile: 'secure_input_envelope_v1',
      contentEncryption: 'AES-256-GCM',
      keyEncryption: 'RSA-OAEP-256',
      preparationId,
      workflowRunId: runId,
      keyId: localKey.metadata.keyId,
      expiresAt,
      aad: aadBytes.toString('base64url'),
      iv: iv.toString('base64url'),
      wrappedKey: wrappedKey.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      ciphertextDigest: createHash('sha256').update(ciphertext).digest('hex'),
    });
    const runtime = await acquireSecureRuntime({
      runtimeInput: { kind: 'encrypted_envelope', envelope, aad, manifest },
      keyManager,
      secretProvider: new InMemorySecretProvider({}),
      signal: new AbortController().signal,
      now: new Date(),
    });
    try {
      const result = await new LocalWorkflowExecutor(
        new PlaywrightBrowserSessionFactory(),
      ).execute(
        {
          schemaVersion: 1,
          workflow,
          inputs: { schemaVersion: 1, values: {} },
          allowedOrigins: [server.origin],
          options: {
            headless: true,
            actionTimeoutMs: 10_000,
            navigationTimeoutMs: 10_000,
            totalTimeoutMs: 30_000,
            stepTimeoutMs: 10_000,
          },
        },
        undefined,
        runId,
        runtime.resolver,
      );
      expect(result.status, JSON.stringify(result)).toBe('succeeded');
      expect(server.completed()).toBe(true);
      expect(JSON.stringify(result)).not.toContain(safeValue);
    } finally {
      await runtime.dispose();
    }
  });
});
