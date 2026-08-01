import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';

import {
  KEY_ENCRYPTION_ALGORITHM,
  RUNNER_RSA_MODULUS_LENGTH,
  RunnerPublicKeyMetadataSchema,
  SECURE_INPUT_ENVELOPE_PROFILE,
} from '@tasktwin/secure-run-inputs';
import type { StoredRunnerCredential } from '@tasktwin/runner-protocol';

import type { RunnerControlPlaneTransport } from '../control-plane-client.js';
import type {
  RunnerEncryptionKeyStore,
  StoredRunnerEncryptionKey,
} from './runner-encryption-key-store.js';

export class RunnerKeyManager {
  constructor(
    private readonly store: RunnerEncryptionKeyStore,
    private readonly transport: RunnerControlPlaneTransport,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureRegistered(
    credential: StoredRunnerCredential,
  ): Promise<StoredRunnerEncryptionKey> {
    let key = await this.store.load();
    if (key === null) {
      key = this.generate();
      await this.store.save(key);
    }
    await this.transport.registerEncryptionKey(credential, {
      schemaVersion: 1,
      key: key.metadata,
    });
    return key;
  }

  async loadRequired(): Promise<StoredRunnerEncryptionKey> {
    const key = await this.store.load();
    if (key === null) {
      throw new Error('The local Runner encryption key is unavailable.');
    }
    return key;
  }

  clear(): Promise<void> {
    return this.store.clear();
  }

  private generate(): StoredRunnerEncryptionKey {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: RUNNER_RSA_MODULUS_LENGTH,
      publicExponent: 0x10001,
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });
    const metadata = RunnerPublicKeyMetadataSchema.parse({
      schemaVersion: 1,
      keyId: `rk1_${randomBytes(32).toString('base64url')}`,
      profile: SECURE_INPUT_ENVELOPE_PROFILE,
      algorithm: KEY_ENCRYPTION_ALGORITHM,
      publicKeyFormat: 'spki',
      publicKeySpki: pair.publicKey.toString('base64url'),
      fingerprint: createHash('sha256').update(pair.publicKey).digest('hex'),
    });
    return {
      schemaVersion: 1,
      metadata,
      privateKeyFormat: 'pkcs8',
      privateKeyPkcs8: pair.privateKey.toString('base64url'),
      createdAt: this.now().toISOString(),
    };
  }
}
