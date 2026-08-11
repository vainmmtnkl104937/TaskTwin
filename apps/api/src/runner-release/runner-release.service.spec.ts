import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { RunnerReleaseRepository } from '@tasktwin/database';
import { RunnerReleaseRepositoryError } from '@tasktwin/database';
import {
  canonicalizeReleaseManifest,
  ReleaseManifestSchema,
  type TrustedReleaseKey,
} from '@tasktwin/runner-release';
import { describe, expect, it, vi } from 'vitest';

import { RunnerReleaseService } from './runner-release.service.js';

const keyPair = generateKeyPairSync('ed25519');
const privateKey = keyPair.privateKey.export({ format: 'der', type: 'pkcs8' });
const trustedKey: TrustedReleaseKey = {
  keyId: 'catalog-test-key',
  algorithm: 'Ed25519',
  publicKeySpkiDerBase64Url: keyPair.publicKey
    .export({ format: 'der', type: 'spki' })
    .toString('base64url'),
};
const manifest = ReleaseManifestSchema.parse({
  schemaVersion: 1,
  product: 'tasktwin-runner',
  version: '1.2.3',
  channel: 'stable',
  sourceCommit: 'a'.repeat(40),
  builtAt: '2026-08-11T00:00:00.000Z',
  compatibility: {
    runnerProtocolVersion: 2,
    workflowSchema: { readable: { min: 1, max: 1 } },
    localState: { readableSchemas: [1], writableSchema: 1 },
    localSecretVault: {
      readableSchemas: [1],
      writableSchema: 1,
      readableProtectionProfiles: ['windows_dpapi_ng_machine_v1'],
    },
  },
  artifacts: [
    {
      platform: 'windows',
      architecture: 'x64',
      fileName: 'tasktwin-runner-1.2.3-windows-x64.zip',
      archiveFormat: 'zip',
      sizeBytes: 10,
      sha256: 'b'.repeat(64),
    },
  ],
  signingKeyId: trustedKey.keyId,
});

function signedInput(releaseManifest = manifest) {
  const canonical = canonicalizeReleaseManifest(releaseManifest);
  return {
    manifest: releaseManifest,
    signature: {
      schemaVersion: 1 as const,
      algorithm: 'Ed25519' as const,
      keyId: trustedKey.keyId,
      manifestSha256: createHash('sha256')
        .update(canonical, 'utf8')
        .digest('hex'),
      signature: sign(
        null,
        Buffer.from(canonical, 'utf8'),
        createPrivateKey({ key: privateKey, format: 'der', type: 'pkcs8' }),
      ).toString('base64url'),
    },
  };
}

describe('RunnerReleaseService', () => {
  it('imports only a valid signed manifest and passes its canonical digest', async () => {
    const importTrusted = vi.fn().mockResolvedValue({ idempotent: false });
    const service = new RunnerReleaseService(
      { importTrusted } as unknown as RunnerReleaseRepository,
      [trustedKey],
    );
    await expect(service.import('user-id', signedInput())).resolves.toEqual({
      idempotent: false,
    });
    expect(importTrusted).toHaveBeenCalledWith(
      'user-id',
      expect.objectContaining({
        manifest,
        manifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(importTrusted.mock.calls)).not.toMatch(
      /signature|privateKey|artifactBytes|localPath/i,
    );
  });

  it('rejects unsigned metadata, unknown keys and invalid signatures', async () => {
    const service = new RunnerReleaseService(
      { importTrusted: vi.fn() } as unknown as RunnerReleaseRepository,
      [trustedKey],
    );
    await expect(
      service.import('user-id', { manifest }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      new RunnerReleaseService(
        { importTrusted: vi.fn() } as unknown as RunnerReleaseRepository,
        [],
      ).import('user-id', signedInput()),
    ).rejects.toBeInstanceOf(BadRequestException);
    const invalid = signedInput();
    invalid.signature.signature = `${
      invalid.signature.signature.startsWith('A') ? 'B' : 'A'
    }${invalid.signature.signature.slice(1)}`;
    await expect(service.import('user-id', invalid)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('preserves exact retry idempotency and maps version conflicts', async () => {
    const importTrusted = vi
      .fn()
      .mockResolvedValueOnce({ idempotent: false })
      .mockResolvedValueOnce({ idempotent: true })
      .mockRejectedValueOnce(
        new RunnerReleaseRepositoryError('RELEASE_VERSION_CONFLICT'),
      );
    const service = new RunnerReleaseService(
      { importTrusted } as unknown as RunnerReleaseRepository,
      [trustedKey],
    );
    await expect(service.import('user-id', signedInput())).resolves.toEqual({
      idempotent: false,
    });
    await expect(service.import('user-id', signedInput())).resolves.toEqual({
      idempotent: true,
    });
    const modifiedManifest = ReleaseManifestSchema.parse({
      ...manifest,
      builtAt: '2026-08-11T00:00:01.000Z',
    });
    await expect(
      service.import('user-id', signedInput(modifiedManifest)),
    ).rejects.toBeInstanceOf(ConflictException);
    const firstDigest = importTrusted.mock.calls[0]?.[1].manifestDigest;
    expect(importTrusted.mock.calls[1]?.[1].manifestDigest).toBe(firstDigest);
    expect(importTrusted.mock.calls[2]?.[1].manifestDigest).not.toBe(
      firstDigest,
    );
  });
});
