import {
  constants,
  createCipheriv,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';

import {
  PlaintextRunInputPayloadSchema,
  RunInputAdditionalAuthenticatedDataSchema,
  SecureRunInputEnvelopeSchema,
  encodeRunInputAad,
} from '@tasktwin/secure-run-inputs';
import { describe, expect, it } from 'vitest';

import { decryptRunInputs } from './decrypt-run-inputs.js';
import type { StoredRunnerEncryptionKey } from './runner-encryption-key-store.js';

const expiresAt = '2030-01-01T00:00:00.000Z';

function key(): StoredRunnerEncryptionKey {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 3_072,
    publicExponent: 0x10001,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return {
    schemaVersion: 1,
    metadata: {
      schemaVersion: 1,
      keyId: `rk1_${randomBytes(32).toString('base64url')}`,
      profile: 'secure_input_envelope_v1',
      algorithm: 'RSA-OAEP-256',
      publicKeyFormat: 'spki',
      publicKeySpki: pair.publicKey.toString('base64url'),
      fingerprint: createHash('sha256').update(pair.publicKey).digest('hex'),
    },
    privateKeyFormat: 'pkcs8',
    privateKeyPkcs8: pair.privateKey.toString('base64url'),
    createdAt: '2029-01-01T00:00:00.000Z',
  };
}

function encryptedFixture(localKey: StoredRunnerEncryptionKey) {
  const aad = RunInputAdditionalAuthenticatedDataSchema.parse({
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
    keyId: localKey.metadata.keyId,
    keyFingerprint: localKey.metadata.fingerprint,
    clientRunId: '88e07996-d768-4643-a93b-132ac5a5661b',
    allowedOrigins: ['http://127.0.0.1:4177'],
    executionOptions: { totalTimeoutMs: 120_000, stepTimeoutMs: 30_000 },
    expiresAt,
  });
  const payload = PlaintextRunInputPayloadSchema.parse({
    schemaVersion: 1,
    preparationId: aad.preparationId,
    workflowRunId: aad.workflowRunId,
    workflowVersionId: aad.workflowVersionId,
    runnerDeviceId: aad.runnerDeviceId,
    keyId: aad.keyId,
    expiresAt,
    inputs: {
      schemaVersion: 1,
      values: { customerName: { kind: 'string', value: 'Ada' } },
    },
  });
  const aadBytes = Buffer.from(encodeRunInputAad(aad));
  const aesKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  cipher.setAAD(aadBytes);
  const encrypted = Buffer.concat([
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
  return {
    aad,
    manifest: {
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
    },
    envelope: SecureRunInputEnvelopeSchema.parse({
      schemaVersion: 1,
      profile: 'secure_input_envelope_v1',
      contentEncryption: 'AES-256-GCM',
      keyEncryption: 'RSA-OAEP-256',
      preparationId: aad.preparationId,
      workflowRunId: aad.workflowRunId,
      keyId: aad.keyId,
      expiresAt,
      aad: aadBytes.toString('base64url'),
      iv: iv.toString('base64url'),
      wrappedKey: wrappedKey.toString('base64url'),
      ciphertext: encrypted.toString('base64url'),
      ciphertextDigest: createHash('sha256').update(encrypted).digest('hex'),
    }),
  };
}

describe('Runner encrypted input decryption', () => {
  it('decrypts and validates a correctly bound envelope', () => {
    const localKey = key();
    const fixture = encryptedFixture(localKey);
    expect(
      decryptRunInputs({
        ...fixture,
        localKey,
        now: new Date('2029-01-01'),
      }).values.customerName,
    ).toEqual({ kind: 'string', value: 'Ada' });
  });

  it('fails safely with another private key, tampered ciphertext, or altered AAD', () => {
    const localKey = key();
    const fixture = encryptedFixture(localKey);
    expect(() =>
      decryptRunInputs({
        ...fixture,
        localKey: key(),
        now: new Date('2029-01-01'),
      }),
    ).toThrow();
    expect(() =>
      decryptRunInputs({
        ...fixture,
        envelope: {
          ...fixture.envelope,
          ciphertext: `${fixture.envelope.ciphertext.slice(0, -1)}A`,
        },
        localKey,
        now: new Date('2029-01-01'),
      }),
    ).toThrow();
    expect(() =>
      decryptRunInputs({
        ...fixture,
        aad: {
          ...fixture.aad,
          workspaceId: 'c41914de-96f9-4e7e-b28f-86a4bc2988e4',
        },
        localKey,
        now: new Date('2029-01-01'),
      }),
    ).toThrow();
  });
});
