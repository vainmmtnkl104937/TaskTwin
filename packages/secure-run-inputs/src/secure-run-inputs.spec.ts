import { describe, expect, it } from 'vitest';

import {
  InMemorySecretProvider,
  RunInputAdditionalAuthenticatedDataSchema,
  RunInputPreparationMetadataSchema,
  RunnerPublicKeyMetadataSchema,
  SecureRunInputEnvelopeSchema,
  assertEnvelopeBinding,
  deriveSecureRunInputManifest,
  encodeRunInputAad,
  validateManifestRuntimeInputs,
} from './index.js';

const ids = {
  preparationId: '9c8cab4d-a965-4812-8b27-e172f93e508e',
  workflowRunId: 'e22a2e45-27d0-41da-af8f-96309acbd7c6',
  workspaceId: '85ea1dc3-0ab5-4407-b54a-f98015c99729',
  workflowVersionId: '5dfc286e-d978-4ae6-a50f-dd6c0e67fe55',
  runnerDeviceId: '15448cc6-d20d-4b89-961e-f090f29baa10',
  clientRunId: '88e07996-d768-4643-a93b-132ac5a5661b',
};

function workflow() {
  return {
    schemaVersion: 1,
    workflowId: 'secure-input-fixture',
    version: 1,
    name: 'Secure input fixture',
    status: 'published',
    variables: [
      {
        name: 'customerName',
        valueType: 'string',
        required: true,
      },
    ],
    steps: [
      {
        id: 'navigate',
        type: 'navigate',
        name: 'Navigate',
        url: { kind: 'literal', value: 'http://127.0.0.1:4177/' },
      },
      {
        id: 'fill-name',
        type: 'fill',
        name: 'Fill name',
        locator: { kind: 'label', value: 'Name' },
        value: { kind: 'variable', variableName: 'customerName' },
      },
      {
        id: 'fill-secret',
        type: 'fill',
        name: 'Fill secret',
        locator: { kind: 'label', value: 'Password' },
        value: { kind: 'secret', secretName: 'crmPassword' },
      },
    ],
  };
}

function aad() {
  return RunInputAdditionalAuthenticatedDataSchema.parse({
    schemaVersion: 1,
    profile: 'secure_input_envelope_v1',
    ...ids,
    workflowId: 'secure-input-fixture',
    workflowVersion: 1,
    definitionDigest: 'a'.repeat(64),
    keyId: `rk1_${'A'.repeat(43)}`,
    keyFingerprint: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4177'],
    executionOptions: { totalTimeoutMs: 120_000, stepTimeoutMs: 30_000 },
    expiresAt: '2030-01-01T00:00:00.000Z',
  });
}

describe('secure run input contracts', () => {
  it('accepts fixed public-key metadata and rejects algorithm substitution', () => {
    const metadata = {
      schemaVersion: 1,
      keyId: `rk1_${'A'.repeat(43)}`,
      profile: 'secure_input_envelope_v1',
      algorithm: 'RSA-OAEP-256',
      publicKeyFormat: 'spki',
      publicKeySpki: 'AAAA',
      fingerprint: 'a'.repeat(64),
    };
    expect(RunnerPublicKeyMetadataSchema.safeParse(metadata).success).toBe(
      true,
    );
    expect(
      RunnerPublicKeyMetadataSchema.safeParse({
        ...metadata,
        algorithm: 'RSA-OAEP-SHA1',
      }).success,
    ).toBe(false);
  });

  it('derives only variable declarations and secret references', () => {
    const manifest = deriveSecureRunInputManifest(workflow());
    expect(manifest.variables).toEqual([
      expect.objectContaining({ name: 'customerName', requiredForRun: true }),
    ]);
    expect(manifest.secrets).toEqual([
      { secretName: 'crmPassword', usageCount: 1 },
    ]);
    expect(JSON.stringify(manifest)).not.toContain('secret-value');
  });

  it('validates declared runtime values and rejects unknown values', () => {
    const manifest = deriveSecureRunInputManifest(workflow());
    expect(
      validateManifestRuntimeInputs(manifest, {
        schemaVersion: 1,
        values: { customerName: { kind: 'string', value: 'Ada' } },
      }).values.customerName,
    ).toEqual({ kind: 'string', value: 'Ada' });
    expect(() =>
      validateManifestRuntimeInputs(manifest, {
        schemaVersion: 1,
        values: {
          customerName: { kind: 'string', value: 'Ada' },
          unexpected: { kind: 'string', value: 'blocked' },
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'RUNTIME_INPUTS_INVALID' }));
  });

  it('uses deterministic AAD and rejects altered or expired binding', () => {
    const binding = aad();
    const envelope = SecureRunInputEnvelopeSchema.parse({
      schemaVersion: 1,
      profile: 'secure_input_envelope_v1',
      contentEncryption: 'AES-256-GCM',
      keyEncryption: 'RSA-OAEP-256',
      preparationId: binding.preparationId,
      workflowRunId: binding.workflowRunId,
      keyId: binding.keyId,
      expiresAt: binding.expiresAt,
      aad: Buffer.from(encodeRunInputAad(binding)).toString('base64url'),
      iv: 'A'.repeat(16),
      wrappedKey: 'A',
      ciphertext: 'A',
      ciphertextDigest: 'c'.repeat(64),
    });
    expect(() =>
      assertEnvelopeBinding(envelope, binding, new Date('2029-01-01')),
    ).not.toThrow();
    expect(() =>
      assertEnvelopeBinding(
        { ...envelope, workflowRunId: ids.workspaceId },
        binding,
        new Date('2029-01-01'),
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'ENVELOPE_BINDING_INVALID' }),
    );
    expect(() =>
      assertEnvelopeBinding(envelope, binding, new Date('2031-01-01')),
    ).toThrowError(expect.objectContaining({ code: 'PREPARATION_EXPIRED' }));
  });

  it('validates a strict preparation and bounds envelope encodings', () => {
    const binding = aad();
    const key = {
      schemaVersion: 1 as const,
      keyId: binding.keyId,
      profile: 'secure_input_envelope_v1' as const,
      algorithm: 'RSA-OAEP-256' as const,
      publicKeyFormat: 'spki' as const,
      publicKeySpki: 'AAAA',
      fingerprint: binding.keyFingerprint,
    };
    expect(
      RunInputPreparationMetadataSchema.safeParse({
        schemaVersion: 1,
        preparationId: binding.preparationId,
        clientPreparationId: '2323baf9-558c-4346-bb00-da01e66a8b9c',
        clientRunId: binding.clientRunId,
        workflowRunId: binding.workflowRunId,
        workspaceId: binding.workspaceId,
        workflowVersionId: binding.workflowVersionId,
        runnerDeviceId: binding.runnerDeviceId,
        expiresAt: binding.expiresAt,
        manifest: deriveSecureRunInputManifest(workflow()),
        key,
        aad: binding,
      }).success,
    ).toBe(true);
    expect(
      SecureRunInputEnvelopeSchema.safeParse({
        schemaVersion: 1,
        profile: 'secure_input_envelope_v1',
        contentEncryption: 'AES-256-GCM',
        keyEncryption: 'RSA-OAEP-256',
        preparationId: binding.preparationId,
        workflowRunId: binding.workflowRunId,
        keyId: binding.keyId,
        expiresAt: binding.expiresAt,
        aad: 'not+base64',
        iv: 'A'.repeat(16),
        wrappedKey: 'A',
        ciphertext: 'A'.repeat(100_000),
        ciphertextDigest: 'c'.repeat(64),
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it('disposes a secret lease idempotently', async () => {
    const lease = await new InMemorySecretProvider({
      crmPassword: 'fake-secret',
    }).acquire(
      [{ secretName: 'crmPassword', usageCount: 1 }],
      new AbortController().signal,
    );
    expect(lease.resolve('crmPassword')).toBe('fake-secret');
    await lease.dispose();
    await lease.dispose();
    expect(() => lease.resolve('crmPassword')).toThrowError(
      expect.objectContaining({ code: 'SECRET_UNAVAILABLE' }),
    );
  });
});
