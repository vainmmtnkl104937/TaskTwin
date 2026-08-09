import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ReleaseManifestSchema,
  ReleaseSignatureSchema,
  canonicalizeReleaseManifest,
  type ReleaseManifest,
  type TrustedReleaseKey,
} from '@tasktwin/runner-release';
import { describe, expect, it } from 'vitest';

import { verifyReleaseFiles } from './release-file-verifier.js';
import { runReleaseCli } from './release-cli.js';
import { nodeReleaseVerificationCrypto } from './node-release-crypto.js';

function digest(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tasktwin-release-files-'));
  const artifactPath = join(directory, 'tasktwin-runner-1.4.0-windows-x64.zip');
  const manifestPath = join(directory, 'release-manifest.json');
  const signaturePath = join(directory, 'release-signature.json');
  const artifact = Buffer.from('controlled-windows-x64-artifact');
  await writeFile(artifactPath, artifact);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keyId = 'runner-release-test-31';
  const manifest = ReleaseManifestSchema.parse({
    schemaVersion: 1,
    product: 'tasktwin-runner',
    version: '1.4.0',
    channel: 'stable',
    sourceCommit: 'a'.repeat(40),
    builtAt: '2026-08-09T00:00:00.000Z',
    compatibility: {
      runnerProtocolVersion: 2,
      workflowSchema: { readable: { min: 1, max: 1 } },
      localState: { readableSchemas: [1], writableSchema: 1 },
      localSecretVault: {
        readableSchemas: [1],
        writableSchema: 1,
        readableProtectionProfiles: [
          'local_secret_master_key_wrap_v1',
          'windows_dpapi_ng_machine_v1',
        ],
      },
    },
    artifacts: [
      {
        platform: 'windows',
        architecture: 'x64',
        fileName: 'tasktwin-runner-1.4.0-windows-x64.zip',
        archiveFormat: 'zip',
        sizeBytes: artifact.byteLength,
        sha256: digest(artifact),
      },
    ],
    signingKeyId: keyId,
  });
  const canonical = canonicalizeReleaseManifest(manifest);
  const signature = ReleaseSignatureSchema.parse({
    schemaVersion: 1,
    algorithm: 'Ed25519',
    keyId,
    manifestSha256: digest(canonical),
    signature: sign(null, Buffer.from(canonical), privateKey).toString(
      'base64url',
    ),
  });
  const trustedKey: TrustedReleaseKey = {
    keyId,
    algorithm: 'Ed25519',
    publicKeySpkiDerBase64Url: publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64url'),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  await writeFile(signaturePath, `${JSON.stringify(signature)}\n`);
  return {
    artifact,
    artifactPath,
    directory,
    manifest,
    manifestPath,
    signature,
    signaturePath,
    trustedKey,
  };
}

describe('Local Runner release-file verification', () => {
  it('verifies a trusted signature, exact size, name, and SHA-256', async () => {
    const input = await fixture();
    await expect(
      verifyReleaseFiles({
        manifestPath: input.manifestPath,
        signaturePath: input.signaturePath,
        artifactPath: input.artifactPath,
        trustedKeys: [input.trustedKey],
      }),
    ).resolves.toMatchObject({
      manifestSha256: input.signature.manifestSha256,
    });
    const output: string[] = [];
    await expect(
      runReleaseCli({
        argv: [
          'release',
          'verify',
          input.manifestPath,
          input.signaturePath,
          input.artifactPath,
        ],
        buildIdentity: {
          product: 'tasktwin-runner',
          version: '1.3.0',
          sourceCommit: 'b'.repeat(40),
          platform: 'windows',
          architecture: 'x64',
          runnerProtocolVersion: 2,
          workflowSchemaVersion: 1,
          localStateSchemaVersion: 1,
          localSecretVaultSchemaVersion: 1,
        },
        output: { write: (message) => output.push(message) },
        trustedKeys: [input.trustedKey],
      }),
    ).resolves.toBe(0);
    expect(JSON.parse(output[0] ?? '{}')).toMatchObject({ verified: true });
  });

  it('runs compatible and downgrade-blocked preflight without mutating local state', async () => {
    const input = await fixture();
    const stateRoot = join(input.directory, '.tasktwin');
    await mkdir(stateRoot);
    const credentialPath = join(stateRoot, 'runner-credential.json');
    const vaultPath = join(stateRoot, 'local-secret-vault.v1.json');
    await writeFile(credentialPath, JSON.stringify({ schemaVersion: 1 }));
    await writeFile(
      vaultPath,
      JSON.stringify({
        schemaVersion: 1,
        masterKeyProtection: { profile: 'windows_dpapi_ng_machine_v1' },
      }),
    );
    const beforeBytes = await Promise.all([
      readFile(credentialPath),
      readFile(vaultPath),
    ]);
    const beforeTimes = await Promise.all([
      stat(credentialPath),
      stat(vaultPath),
    ]);
    const baseIdentity = {
      product: 'tasktwin-runner' as const,
      sourceCommit: 'b'.repeat(40),
      platform: 'windows' as const,
      architecture: 'x64' as const,
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      localSecretVaultSchemaVersion: 1,
    };
    const args = [
      'upgrade',
      'preflight',
      input.manifestPath,
      input.signaturePath,
      input.artifactPath,
      '--data-root',
      input.directory,
    ];
    const compatibleOutput: string[] = [];
    await expect(
      runReleaseCli({
        argv: args,
        buildIdentity: { ...baseIdentity, version: '1.3.0' },
        output: { write: (message) => compatibleOutput.push(message) },
        trustedKeys: [input.trustedKey],
      }),
    ).resolves.toBe(0);
    expect(JSON.parse(compatibleOutput[0] ?? '{}')).toMatchObject({
      decision: 'compatible',
    });
    expect(await readFile(credentialPath)).toEqual(beforeBytes[0]);
    expect(await readFile(vaultPath)).toEqual(beforeBytes[1]);
    expect((await stat(credentialPath)).mtimeMs).toBe(beforeTimes[0].mtimeMs);
    expect((await stat(vaultPath)).mtimeMs).toBe(beforeTimes[1].mtimeMs);

    const unsupportedPlatformOutput: string[] = [];
    await expect(
      runReleaseCli({
        argv: args,
        buildIdentity: {
          ...baseIdentity,
          version: '1.3.0',
          platform: 'linux',
        },
        output: {
          write: (message) => unsupportedPlatformOutput.push(message),
        },
        trustedKeys: [input.trustedKey],
      }),
    ).resolves.toBe(2);
    expect(JSON.parse(unsupportedPlatformOutput[0] ?? '{}')).toMatchObject({
      decision: 'unsupported',
      reasons: ['target_artifact_missing'],
    });

    await writeFile(
      vaultPath,
      JSON.stringify({
        schemaVersion: 1,
        masterKeyProtection: { profile: 'future_vault_profile_31' },
      }),
    );
    const downgradeBytes = await Promise.all([
      readFile(credentialPath),
      readFile(vaultPath),
    ]);
    const downgradeTimes = await Promise.all([
      stat(credentialPath),
      stat(vaultPath),
    ]);
    const downgradeOutput: string[] = [];
    await expect(
      runReleaseCli({
        argv: args,
        buildIdentity: { ...baseIdentity, version: '2.0.0' },
        output: { write: (message) => downgradeOutput.push(message) },
        trustedKeys: [input.trustedKey],
      }),
    ).resolves.toBe(2);
    expect(JSON.parse(downgradeOutput[0] ?? '{}')).toMatchObject({
      decision: 'downgrade_blocked',
    });
    expect(await readFile(credentialPath)).toEqual(downgradeBytes[0]);
    expect(await readFile(vaultPath)).toEqual(downgradeBytes[1]);
    expect((await stat(credentialPath)).mtimeMs).toBe(
      downgradeTimes[0].mtimeMs,
    );
    expect((await stat(vaultPath)).mtimeMs).toBe(downgradeTimes[1].mtimeMs);
    expect(beforeBytes[0]).toEqual(downgradeBytes[0]);
    expect(beforeTimes[0].mtimeMs).toBe(downgradeTimes[0].mtimeMs);
  });

  it('rejects every key when no production trust key has been provisioned', async () => {
    const input = await fixture();
    await expect(
      verifyReleaseFiles({
        manifestPath: input.manifestPath,
        signaturePath: input.signaturePath,
        artifactPath: input.artifactPath,
      }),
    ).rejects.toMatchObject({ code: 'release_signing_key_unknown' });
  });

  it('rejects non-Ed25519 SPKI material mislabeled as a trusted Ed25519 key', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const canonicalManifest = '{"schemaVersion":1}';
    const signature = sign(
      null,
      Buffer.from(canonicalManifest, 'utf8'),
      privateKey,
    );

    expect(
      nodeReleaseVerificationCrypto.verifyEd25519({
        canonicalManifest,
        signatureBase64Url: signature.toString('base64url'),
        publicKeySpkiDerBase64Url: publicKey
          .export({ format: 'der', type: 'spki' })
          .toString('base64url'),
      }),
    ).toBe(false);
  });

  it('fails closed after one artifact byte changes', async () => {
    const input = await fixture();
    const changed = Buffer.from(await readFile(input.artifactPath));
    changed[0] = (changed[0] ?? 0) ^ 1;
    await writeFile(input.artifactPath, changed);
    await expect(
      verifyReleaseFiles({
        manifestPath: input.manifestPath,
        signaturePath: input.signaturePath,
        artifactPath: input.artifactPath,
        trustedKeys: [input.trustedKey],
      }),
    ).rejects.toMatchObject({ code: 'release_artifact_hash_mismatch' });
  });

  it('fails closed on artifact-size and signature mismatches', async () => {
    const input = await fixture();
    await writeFile(
      input.artifactPath,
      Buffer.concat([input.artifact, Buffer.from('x')]),
    );
    await expect(
      verifyReleaseFiles({
        manifestPath: input.manifestPath,
        signaturePath: input.signaturePath,
        artifactPath: input.artifactPath,
        trustedKeys: [input.trustedKey],
      }),
    ).rejects.toMatchObject({ code: 'release_artifact_size_mismatch' });

    await writeFile(input.artifactPath, input.artifact);
    const changedSignature = Buffer.from(
      input.signature.signature,
      'base64url',
    );
    changedSignature[0] = (changedSignature[0] ?? 0) ^ 1;
    const invalidSignature = {
      ...input.signature,
      signature: changedSignature.toString('base64url'),
    };
    await writeFile(input.signaturePath, JSON.stringify(invalidSignature));
    await expect(
      verifyReleaseFiles({
        manifestPath: input.manifestPath,
        signaturePath: input.signaturePath,
        artifactPath: input.artifactPath,
        trustedKeys: [input.trustedKey],
      }),
    ).rejects.toMatchObject({ code: 'release_signature_verification_failed' });
  });

  it('rejects a modified manifest and an unknown key ID', async () => {
    const input = await fixture();
    const modified: ReleaseManifest = {
      ...input.manifest,
      builtAt: '2026-08-09T00:00:01.000Z',
    };
    await writeFile(input.manifestPath, JSON.stringify(modified));
    await expect(
      verifyReleaseFiles({
        manifestPath: input.manifestPath,
        signaturePath: input.signaturePath,
        artifactPath: input.artifactPath,
        trustedKeys: [input.trustedKey],
      }),
    ).rejects.toMatchObject({ code: 'release_manifest_digest_mismatch' });

    await writeFile(
      input.manifestPath,
      JSON.stringify({ ...input.manifest, signingKeyId: 'unknown-key-31' }),
    );
    await writeFile(
      input.signaturePath,
      JSON.stringify({ ...input.signature, keyId: 'unknown-key-31' }),
    );
    await expect(
      verifyReleaseFiles({
        manifestPath: input.manifestPath,
        signaturePath: input.signaturePath,
        artifactPath: input.artifactPath,
        trustedKeys: [input.trustedKey],
      }),
    ).rejects.toMatchObject({ code: 'release_signing_key_unknown' });
  });
});
