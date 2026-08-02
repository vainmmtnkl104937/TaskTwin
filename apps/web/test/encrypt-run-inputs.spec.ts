import { createHash, generateKeyPairSync } from 'node:crypto';

import type { RunInputPreparationMetadata } from '@tasktwin/secure-run-inputs';
import { describe, expect, it } from 'vitest';

import { encryptRunInputs } from '@/components/workflow-runs/encrypt-run-inputs';

function preparation(): RunInputPreparationMetadata {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 3_072,
    publicExponent: 0x10001,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  const keyId = `rk1_${'A'.repeat(43)}`;
  const expiresAt = '2030-01-01T00:00:00.000Z';
  return {
    schemaVersion: 1,
    preparationId: '9c8cab4d-a965-4812-8b27-e172f93e508e',
    clientPreparationId: '2323baf9-558c-4346-bb00-da01e66a8b9c',
    clientRunId: '88e07996-d768-4643-a93b-132ac5a5661b',
    workflowRunId: 'e22a2e45-27d0-41da-af8f-96309acbd7c6',
    workspaceId: '85ea1dc3-0ab5-4407-b54a-f98015c99729',
    workflowVersionId: '5dfc286e-d978-4ae6-a50f-dd6c0e67fe55',
    runnerDeviceId: '15448cc6-d20d-4b89-961e-f090f29baa10',
    expiresAt,
    manifest: {
      schemaVersion: 1,
      variables: [
        {
          name: 'customerName',
          valueType: 'string',
          required: true,
          requiredForRun: true,
          usageCount: 1,
        },
      ],
      secrets: [],
    },
    key: {
      schemaVersion: 1,
      keyId,
      profile: 'secure_input_envelope_v1',
      algorithm: 'RSA-OAEP-256',
      publicKeyFormat: 'spki',
      publicKeySpki: pair.publicKey.toString('base64url'),
      fingerprint: createHash('sha256').update(pair.publicKey).digest('hex'),
    },
    aad: {
      schemaVersion: 1,
      profile: 'secure_input_envelope_v1',
      preparationId: '9c8cab4d-a965-4812-8b27-e172f93e508e',
      workflowRunId: 'e22a2e45-27d0-41da-af8f-96309acbd7c6',
      workspaceId: '85ea1dc3-0ab5-4407-b54a-f98015c99729',
      workflowId: 'secure-input-fixture',
      workflowVersionId: '5dfc286e-d978-4ae6-a50f-dd6c0e67fe55',
      workflowVersion: 1,
      definitionDigest: 'a'.repeat(64),
      runnerDeviceId: '15448cc6-d20d-4b89-961e-f090f29baa10',
      keyId,
      keyFingerprint: createHash('sha256').update(pair.publicKey).digest('hex'),
      clientRunId: '88e07996-d768-4643-a93b-132ac5a5661b',
      allowedOrigins: ['http://127.0.0.1:4177'],
      executionOptions: {
        totalTimeoutMs: 120_000,
        stepTimeoutMs: 30_000,
        recoveryMode: 'automatic_safe_only',
      },
      expiresAt,
    },
  };
}

describe('browser run-input encryption', () => {
  it('uses a fresh IV and exposes no plaintext in either envelope', async () => {
    const prep = preparation();
    const inputs = {
      schemaVersion: 1 as const,
      values: {
        customerName: { kind: 'string' as const, value: 'Ada Lovelace' },
      },
    };
    const first = await encryptRunInputs(prep, inputs);
    const second = await encryptRunInputs(prep, inputs);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(JSON.stringify(first)).not.toContain('Ada Lovelace');
    expect(JSON.stringify(second)).not.toContain('Ada Lovelace');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
