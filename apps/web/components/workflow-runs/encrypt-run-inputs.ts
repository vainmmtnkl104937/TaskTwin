import {
  AES_GCM_IV_BYTES,
  CONTENT_ENCRYPTION_ALGORITHM,
  KEY_ENCRYPTION_ALGORITHM,
  PlaintextRunInputPayloadSchema,
  SECURE_INPUT_ENVELOPE_PROFILE,
  SecureRunInputEnvelopeSchema,
  encodeRunInputAad,
  type RunInputPreparationMetadata,
} from '@tasktwin/secure-run-inputs';
import type { WorkflowRunInputSubmission } from '@tasktwin/workflow-inputs';

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function encryptRunInputs(
  preparation: RunInputPreparationMetadata,
  inputs: WorkflowRunInputSubmission,
) {
  if (Date.parse(preparation.expiresAt) <= Date.now()) {
    throw new Error('The secure input preparation expired.');
  }
  const payload = PlaintextRunInputPayloadSchema.parse({
    schemaVersion: 1,
    preparationId: preparation.preparationId,
    workflowRunId: preparation.workflowRunId,
    workflowVersionId: preparation.workflowVersionId,
    runnerDeviceId: preparation.runnerDeviceId,
    keyId: preparation.key.keyId,
    expiresAt: preparation.expiresAt,
    inputs,
  });
  const aad = encodeRunInputAad(preparation.aad);
  const publicKey = await crypto.subtle.importKey(
    'spki',
    decodeBase64Url(preparation.key.publicKeySpki),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const contentKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aad),
      tagLength: 128,
    },
    contentKey,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const rawKey = await crypto.subtle.exportKey('raw', contentKey);
  const wrappedKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    rawKey,
  );
  return SecureRunInputEnvelopeSchema.parse({
    schemaVersion: 1,
    profile: SECURE_INPUT_ENVELOPE_PROFILE,
    contentEncryption: CONTENT_ENCRYPTION_ALGORITHM,
    keyEncryption: KEY_ENCRYPTION_ALGORITHM,
    preparationId: preparation.preparationId,
    workflowRunId: preparation.workflowRunId,
    keyId: preparation.key.keyId,
    expiresAt: preparation.expiresAt,
    aad: encodeBase64Url(aad),
    iv: encodeBase64Url(iv),
    wrappedKey: encodeBase64Url(wrappedKey),
    ciphertext: encodeBase64Url(ciphertext),
    ciphertextDigest: hex(await crypto.subtle.digest('SHA-256', ciphertext)),
  });
}
