import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ControlPlaneRunnerCompatibilityPolicySchema,
  ProductSemVerSchema,
  ReleaseManifestSchema,
  RunnerReleaseArchitectureSchema,
  RunnerReleaseError,
  RunnerReleasePlatformSchema,
  RunnerSoftwareIdentitySchema,
  canonicalizeReleaseManifest,
  evaluateRunnerCompatibility,
  evaluateUpgradePreflight,
  summarizeRelease,
  verifyRelease,
  verifyReleaseManifest,
  type ReleaseManifest,
  type ReleaseSignature,
  type ReleaseVerificationCrypto,
  type TrustedReleaseKey,
} from '../src/index.js';

const ARTIFACT_SHA256 = 'a'.repeat(64);
const MANIFEST_SOURCE_COMMIT = 'b'.repeat(40);

function manifestFixture(): ReleaseManifest {
  return ReleaseManifestSchema.parse({
    schemaVersion: 1,
    product: 'tasktwin-runner',
    version: '1.4.0',
    channel: 'stable',
    sourceCommit: MANIFEST_SOURCE_COMMIT,
    builtAt: '2026-08-09T00:00:00.000Z',
    compatibility: {
      runnerProtocolVersion: 2,
      workflowSchema: { readable: { min: 1, max: 1 } },
      localState: { readableSchemas: [1, 2], writableSchema: 2 },
      localSecretVault: {
        readableSchemas: [1, 2],
        writableSchema: 2,
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
        sizeBytes: 42,
        sha256: ARTIFACT_SHA256,
      },
    ],
    signingKeyId: 'runner-release-test-1',
  });
}

const compatibilityPolicy = ControlPlaneRunnerCompatibilityPolicySchema.parse({
  product: 'tasktwin-runner',
  supportedPlatforms: ['windows'],
  supportedArchitectures: ['x64'],
  supportedRunnerProtocolVersions: [2],
  supportedWorkflowSchemaVersions: [1],
  supportedLocalStateSchemaVersions: [1],
  minimumVersion: '1.2.0',
  recommendedVersion: '1.4.0',
});

function softwareIdentity(version = '1.4.0') {
  return RunnerSoftwareIdentitySchema.parse({
    product: 'tasktwin-runner',
    version,
    runnerProtocolVersion: 2,
    workflowSchemaVersion: 1,
    localStateSchemaVersion: 1,
    platform: 'windows',
    architecture: 'x64',
  });
}

const keyPair = generateKeyPairSync('ed25519');
const privateKeyDer = keyPair.privateKey.export({
  format: 'der',
  type: 'pkcs8',
});
const publicKeyDer = keyPair.publicKey.export({ format: 'der', type: 'spki' });
const trustedKey: TrustedReleaseKey = {
  keyId: 'runner-release-test-1',
  algorithm: 'Ed25519',
  publicKeySpkiDerBase64Url: publicKeyDer.toString('base64url'),
};

const nodeCrypto: ReleaseVerificationCrypto = {
  sha256Hex(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  },
  verifyEd25519(input) {
    return verify(
      null,
      Buffer.from(input.canonicalManifest, 'utf8'),
      createPublicKey({
        key: Buffer.from(input.publicKeySpkiDerBase64Url, 'base64url'),
        format: 'der',
        type: 'spki',
      }),
      Buffer.from(input.signatureBase64Url, 'base64url'),
    );
  },
};

function signManifest(manifest: ReleaseManifest): ReleaseSignature {
  const canonical = canonicalizeReleaseManifest(manifest);
  return {
    schemaVersion: 1,
    algorithm: 'Ed25519',
    keyId: trustedKey.keyId,
    manifestSha256: nodeCrypto.sha256Hex(canonical),
    signature: sign(
      null,
      Buffer.from(canonical, 'utf8'),
      createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' }),
    ).toString('base64url'),
  };
}

function observedArtifact() {
  return {
    platform: 'windows' as const,
    architecture: 'x64' as const,
    fileName: 'tasktwin-runner-1.4.0-windows-x64.zip',
    sizeBytes: 42,
    sha256: ARTIFACT_SHA256,
  };
}

describe('release identity and manifest contracts', () => {
  it.each(['0.1.0', '1.2.3', '1.2.3+build.7'])(
    'accepts canonical SemVer %s',
    (version) => {
      expect(ProductSemVerSchema.parse(version)).toBe(version);
    },
  );

  it.each(['1', '1.2', 'v1.2.3', ' 1.2.3', '1.2.03', 'not-a-version'])(
    'rejects invalid or non-canonical version %s',
    (version) => {
      expect(() => ProductSemVerSchema.parse(version)).toThrow();
    },
  );

  it('matches the persisted and protocol Runner-version length boundary', () => {
    const maximum = `1.2.3+${'a'.repeat(26)}`;
    expect(maximum).toHaveLength(32);
    expect(ProductSemVerSchema.parse(maximum)).toBe(maximum);
    expect(() => ProductSemVerSchema.parse(`${maximum}a`)).toThrow();
  });

  it('validates the extensible target contracts', () => {
    expect(RunnerReleasePlatformSchema.parse('windows')).toBe('windows');
    expect(RunnerReleaseArchitectureSchema.parse('x64')).toBe('x64');
    expect(() => RunnerReleasePlatformSchema.parse('win32')).toThrow();
    expect(() => RunnerReleaseArchitectureSchema.parse('ia32')).toThrow();
  });

  it('accepts a valid release manifest and artifact descriptor', () => {
    expect(manifestFixture().artifacts[0]?.sizeBytes).toBe(42);
  });

  it('strictly rejects unexpected properties', () => {
    expect(() =>
      ReleaseManifestSchema.parse({
        ...manifestFixture(),
        localPath: 'C:\\vault',
      }),
    ).toThrow();
    expect(() =>
      ReleaseManifestSchema.parse({
        ...manifestFixture(),
        artifacts: [
          { ...manifestFixture().artifacts[0], downloadUrl: 'https://x' },
        ],
      }),
    ).toThrow();
  });

  it('rejects an artifact name that is not derived from the release identity', () => {
    expect(() =>
      ReleaseManifestSchema.parse({
        ...manifestFixture(),
        artifacts: [
          { ...manifestFixture().artifacts[0], fileName: 'runner.zip' },
        ],
      }),
    ).toThrow();
  });

  it('rejects a writable persisted schema the target cannot read', () => {
    const manifest = manifestFixture();
    manifest.compatibility.localState = {
      readableSchemas: [1, 2],
      writableSchema: 3,
    };
    expect(() => ReleaseManifestSchema.parse(manifest)).toThrow();
  });

  it('canonicalizes equivalent object insertion orders identically', () => {
    const fixture = manifestFixture();
    const reordered = JSON.parse(
      JSON.stringify(fixture, Object.keys(fixture).reverse()),
    ) as unknown;
    // JSON replacer arrays omit nested fields, so reverse recursively through text instead.
    const topLevelReordered = {
      signingKeyId: fixture.signingKeyId,
      artifacts: fixture.artifacts,
      compatibility: fixture.compatibility,
      builtAt: fixture.builtAt,
      sourceCommit: fixture.sourceCommit,
      channel: fixture.channel,
      version: fixture.version,
      product: fixture.product,
      schemaVersion: fixture.schemaVersion,
    };
    expect(reordered).toBeDefined();
    expect(canonicalizeReleaseManifest(topLevelReordered)).toBe(
      canonicalizeReleaseManifest(fixture),
    );
  });

  it('produces a deterministic manifest digest', () => {
    expect(
      nodeCrypto.sha256Hex(canonicalizeReleaseManifest(manifestFixture())),
    ).toBe('4139ed7432fe23cfdd048e41ead2eab70eb22439787a45db7f1dc60fdc48e580');
  });
});

describe('Control Plane compatibility', () => {
  it('classifies compatible software', () => {
    expect(
      evaluateRunnerCompatibility({
        identity: softwareIdentity(),
        policy: compatibilityPolicy,
      }).status,
    ).toBe('compatible');
  });

  it('allows a compatible but older recommendation', () => {
    expect(
      evaluateRunnerCompatibility({
        identity: softwareIdentity('1.3.0'),
        policy: compatibilityPolicy,
      }).status,
    ).toBe('update_recommended');
  });

  it('requires an update below the supported floor or for missing identity', () => {
    expect(
      evaluateRunnerCompatibility({
        identity: softwareIdentity('1.1.0'),
        policy: compatibilityPolicy,
      }).status,
    ).toBe('update_required');
    expect(
      evaluateRunnerCompatibility({
        identity: null,
        policy: compatibilityPolicy,
      }).status,
    ).toBe('update_required');
  });

  it('rejects unsupported protocol metadata regardless of SemVer', () => {
    expect(
      evaluateRunnerCompatibility({
        identity: { ...softwareIdentity('9.0.0'), runnerProtocolVersion: 99 },
        policy: compatibilityPolicy,
      }).status,
    ).toBe('unsupported');
  });
});

describe('upgrade preflight', () => {
  const base = {
    currentVersion: '1.3.0',
    targetRelease: manifestFixture(),
    currentLocalStateSchemaVersion: 2,
    currentLocalSecretVault: {
      schemaVersion: 2,
      protectionProfile: 'windows_dpapi_ng_machine_v1',
    },
    platform: 'windows' as const,
    architecture: 'x64' as const,
  };

  it('accepts a compatible upgrade without mutation', () => {
    expect(evaluateUpgradePreflight(base).decision).toBe('compatible');
  });

  it('requires migration when the target writes a newer schema', () => {
    const target = manifestFixture();
    target.compatibility.localState.writableSchema = 3;
    target.compatibility.localState.readableSchemas = [1, 2, 3];
    expect(
      evaluateUpgradePreflight({ ...base, targetRelease: target }).decision,
    ).toBe('migration_required');
  });

  it('rejects an unsupported upgrade that cannot read local state', () => {
    const target = manifestFixture();
    target.compatibility.localState = {
      readableSchemas: [1],
      writableSchema: 1,
    };
    expect(
      evaluateUpgradePreflight({ ...base, targetRelease: target }).decision,
    ).toBe('unsupported');
  });

  it('blocks a downgrade that cannot read state or the vault profile', () => {
    const target = manifestFixture();
    target.version = '1.2.0';
    target.artifacts[0]!.fileName = 'tasktwin-runner-1.2.0-windows-x64.zip';
    target.compatibility.localState = {
      readableSchemas: [1],
      writableSchema: 1,
    };
    expect(
      evaluateUpgradePreflight({ ...base, targetRelease: target }).decision,
    ).toBe('downgrade_blocked');
  });
});

describe('detached signature and artifact verification', () => {
  it('verifies a trusted catalog manifest without accepting artifact bytes', () => {
    const manifest = manifestFixture();
    const verified = verifyReleaseManifest({
      manifest,
      signature: signManifest(manifest),
      trustedKeys: [trustedKey],
      crypto: nodeCrypto,
    });
    expect(verified.manifest).toEqual(manifest);
    expect(verified.manifestSha256).toHaveLength(64);
    expect(verified).not.toHaveProperty('artifactBytes');
  });

  it('verifies a trusted signature and exact artifact', () => {
    const manifest = manifestFixture();
    expect(
      verifyRelease({
        manifest,
        signature: signManifest(manifest),
        trustedKeys: [trustedKey],
        artifact: observedArtifact(),
        crypto: nodeCrypto,
      }).manifest.version,
    ).toBe('1.4.0');
  });

  it('rejects an unknown trusted key', () => {
    const manifest = manifestFixture();
    expect(() =>
      verifyRelease({
        manifest,
        signature: signManifest(manifest),
        trustedKeys: [],
        artifact: observedArtifact(),
        crypto: nodeCrypto,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RunnerReleaseError>>({
        code: 'release_signing_key_unknown',
      }),
    );
  });

  it('rejects a modified manifest and invalid signature', () => {
    const manifest = manifestFixture();
    const signature = signManifest(manifest);
    const modified = {
      ...manifest,
      builtAt: '2026-08-10T00:00:00.000Z',
    };
    expect(() =>
      verifyRelease({
        manifest: modified,
        signature,
        trustedKeys: [trustedKey],
        artifact: observedArtifact(),
        crypto: nodeCrypto,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RunnerReleaseError>>({
        code: 'release_manifest_digest_mismatch',
      }),
    );
  });

  it('rejects an invalid signature even when the digest matches', () => {
    const manifest = manifestFixture();
    const signature = signManifest(manifest);
    const invalidSignature = Buffer.from(signature.signature, 'base64url');
    invalidSignature[0] = (invalidSignature[0] ?? 0) ^ 0x01;
    signature.signature = invalidSignature.toString('base64url');
    expect(() =>
      verifyRelease({
        manifest,
        signature,
        trustedKeys: [trustedKey],
        artifact: observedArtifact(),
        crypto: nodeCrypto,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RunnerReleaseError>>({
        code: 'release_signature_verification_failed',
      }),
    );
  });

  it('rejects artifact size and hash mismatches', () => {
    const manifest = manifestFixture();
    const signature = signManifest(manifest);
    expect(() =>
      verifyRelease({
        manifest,
        signature,
        trustedKeys: [trustedKey],
        artifact: { ...observedArtifact(), sizeBytes: 43 },
        crypto: nodeCrypto,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RunnerReleaseError>>({
        code: 'release_artifact_size_mismatch',
      }),
    );
    expect(() =>
      verifyRelease({
        manifest,
        signature,
        trustedKeys: [trustedKey],
        artifact: { ...observedArtifact(), sha256: 'c'.repeat(64) },
        crypto: nodeCrypto,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RunnerReleaseError>>({
        code: 'release_artifact_hash_mismatch',
      }),
    );
  });

  it('returns a safe summary without local or signing material', () => {
    const serialized = JSON.stringify(summarizeRelease(manifestFixture()));
    expect(serialized).not.toContain('C:\\');
    expect(serialized).not.toContain('.tasktwin');
    expect(serialized).not.toContain('private');
    expect(serialized).not.toContain('signature');
    expect(serialized).not.toContain('vaultId');
  });
});
