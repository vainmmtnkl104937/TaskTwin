import { createHash, createPublicKey, verify } from 'node:crypto';

import type { ReleaseVerificationCrypto } from '@tasktwin/runner-release';

export const nodeReleaseVerificationCrypto: ReleaseVerificationCrypto = {
  sha256Hex(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  },
  verifyEd25519(input) {
    try {
      const publicKey = createPublicKey({
        key: Buffer.from(input.publicKeySpkiDerBase64Url, 'base64url'),
        format: 'der',
        type: 'spki',
      });
      if (publicKey.asymmetricKeyType !== 'ed25519') return false;
      return verify(
        null,
        Buffer.from(input.canonicalManifest, 'utf8'),
        publicKey,
        Buffer.from(input.signatureBase64Url, 'base64url'),
      );
    } catch {
      return false;
    }
  },
};
