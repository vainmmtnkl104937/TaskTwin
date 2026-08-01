import {
  constants,
  createDecipheriv,
  createHash,
  createPrivateKey,
  privateDecrypt,
} from 'node:crypto';

import {
  AES_GCM_TAG_BYTES,
  PlaintextRunInputPayloadSchema,
  RunInputAdditionalAuthenticatedDataSchema,
  SecureRunInputError,
  assertEnvelopeBinding,
  assertPlaintextPayloadBinding,
  encodeRunInputAad,
  validateManifestRuntimeInputs,
  type SecureRunInputEnvelope,
  type SecureRunInputManifest,
} from '@tasktwin/secure-run-inputs';

import type { StoredRunnerEncryptionKey } from './runner-encryption-key-store.js';

export function decryptRunInputs(input: {
  envelope: SecureRunInputEnvelope;
  aad: unknown;
  manifest: SecureRunInputManifest;
  localKey: StoredRunnerEncryptionKey;
  now: Date;
}) {
  const aad = RunInputAdditionalAuthenticatedDataSchema.parse(input.aad);
  assertEnvelopeBinding(input.envelope, aad, input.now);
  if (
    input.envelope.keyId !== input.localKey.metadata.keyId ||
    aad.keyFingerprint !== input.localKey.metadata.fingerprint ||
    input.envelope.aad !==
      Buffer.from(encodeRunInputAad(aad)).toString('base64url') ||
    createHash('sha256')
      .update(Buffer.from(input.envelope.ciphertext, 'base64url'))
      .digest('hex') !== input.envelope.ciphertextDigest
  ) {
    throw new SecureRunInputError('ENVELOPE_BINDING_INVALID');
  }
  const wrappedKey = Buffer.from(input.envelope.wrappedKey, 'base64url');
  const ciphertextAndTag = Buffer.from(input.envelope.ciphertext, 'base64url');
  const iv = Buffer.from(input.envelope.iv, 'base64url');
  const tagOffset = ciphertextAndTag.length - AES_GCM_TAG_BYTES;
  if (tagOffset <= 0) throw new SecureRunInputError('DECRYPTION_FAILED');
  let aesKey: Buffer | undefined;
  let plaintext: Buffer | undefined;
  try {
    const privateKey = createPrivateKey({
      key: Buffer.from(input.localKey.privateKeyPkcs8, 'base64url'),
      format: 'der',
      type: 'pkcs8',
    });
    aesKey = privateDecrypt(
      {
        key: privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      wrappedKey,
    );
    const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAAD(Buffer.from(encodeRunInputAad(aad)));
    decipher.setAuthTag(ciphertextAndTag.subarray(tagOffset));
    plaintext = Buffer.concat([
      decipher.update(ciphertextAndTag.subarray(0, tagOffset)),
      decipher.final(),
    ]);
    const payload = PlaintextRunInputPayloadSchema.parse(
      JSON.parse(plaintext.toString('utf8')) as unknown,
    );
    assertPlaintextPayloadBinding(payload, aad, input.now);
    return validateManifestRuntimeInputs(input.manifest, payload.inputs);
  } catch (error: unknown) {
    if (error instanceof SecureRunInputError) throw error;
    throw new SecureRunInputError('DECRYPTION_FAILED');
  } finally {
    aesKey?.fill(0);
    plaintext?.fill(0);
    wrappedKey.fill(0);
    ciphertextAndTag.fill(0);
  }
}
