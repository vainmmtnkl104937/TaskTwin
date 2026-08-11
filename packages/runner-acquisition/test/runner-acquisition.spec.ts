import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ReleaseManifestSchema,
  deriveRunnerReleaseId,
  type VerifiedReleaseManifest,
} from '@tasktwin/runner-release';
import { describe, expect, it } from 'vitest';

import {
  CachedRunnerReleaseSchema,
  MAX_RELEASE_ARTIFACT_BYTES,
  PartialReleaseAcquisitionSchema,
  RunnerAcquisitionError,
  TrustedReleaseSourceSchema,
  assertReferenceMatchesManifest,
  assertReleaseAcquisitionTransition,
  assertResumeResponse,
  assertUrlWithinTrustedSource,
  decidePartialDownload,
  deriveReleaseArtifactUrl,
  deriveReleaseMetadataUrls,
  summarizeCachedRelease,
} from '../src/index.js';

const digest = 'a'.repeat(64);
const source = {
  sourceId: 'tasktwin-production',
  origin: 'https://releases.tasktwin.example',
  pathPrefix: '/runner/releases/v1',
};
const artifact = {
  platform: 'windows' as const,
  architecture: 'x64' as const,
  fileName: 'tasktwin-runner-1.2.3-windows-x64.zip',
  archiveFormat: 'zip' as const,
  sizeBytes: 100,
  sha256: 'b'.repeat(64),
};
const manifest = ReleaseManifestSchema.parse({
  schemaVersion: 1,
  product: 'tasktwin-runner',
  version: '1.2.3',
  channel: 'stable',
  sourceCommit: 'c'.repeat(40),
  builtAt: '2026-08-12T00:00:00.000Z',
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
  artifacts: [artifact],
  signingKeyId: 'release-key',
});
const verifiedManifest = {
  manifest,
  signature: {
    schemaVersion: 1 as const,
    algorithm: 'Ed25519' as const,
    keyId: 'release-key',
    manifestSha256: digest,
    signature: 'AAAA',
  },
  canonicalManifest: '{}',
  manifestSha256: digest,
} satisfies VerifiedReleaseManifest;

function partial(overrides: Record<string, unknown> = {}) {
  return PartialReleaseAcquisitionSchema.parse({
    schemaVersion: 1,
    sourceId: source.sourceId,
    releaseId: deriveRunnerReleaseId(digest),
    manifestSha256: digest,
    version: manifest.version,
    artifact,
    strongEtag: '"artifact-v1"',
    rangeSupported: true,
    downloadedBytes: 40,
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:01.000Z',
    ...overrides,
  });
}

describe('trusted source policy', () => {
  it('derives metadata and artifact URLs only below an exact HTTPS source', () => {
    const urls = deriveReleaseMetadataUrls(source, manifest.version);
    expect(urls).toEqual({
      releaseDirectoryUrl:
        'https://releases.tasktwin.example/runner/releases/v1/1.2.3/',
      manifestUrl:
        'https://releases.tasktwin.example/runner/releases/v1/1.2.3/release-manifest.json',
      signatureUrl:
        'https://releases.tasktwin.example/runner/releases/v1/1.2.3/release-signature.json',
    });
    expect(
      deriveReleaseArtifactUrl({
        releaseDirectoryUrl: urls.releaseDirectoryUrl,
        artifactFileName: artifact.fileName,
        source,
      }),
    ).toBe(`${urls.releaseDirectoryUrl}${artifact.fileName}`);
  });

  it.each([
    { ...source, origin: 'http://releases.tasktwin.example' },
    { ...source, origin: 'https://user@releases.tasktwin.example' },
    { ...source, origin: 'https://releases.tasktwin.example/path' },
    { ...source, pathPrefix: '/../escape' },
  ])('rejects an unsafe source %#', (candidate) => {
    expect(() => TrustedReleaseSourceSchema.parse(candidate)).toThrow();
  });

  it('rejects URLs outside the exact origin and path prefix', () => {
    expect(() =>
      assertUrlWithinTrustedSource(
        'https://evil.example/runner/releases/v1/x',
        source,
      ),
    ).toThrow(RunnerAcquisitionError);
    expect(() =>
      assertUrlWithinTrustedSource(
        'https://releases.tasktwin.example/other/x',
        source,
      ),
    ).toThrow(RunnerAcquisitionError);
  });

  it('binds version and digest references to verified manifest identity', () => {
    expect(() =>
      assertReferenceMatchesManifest('1.2.3', verifiedManifest),
    ).not.toThrow();
    expect(() =>
      assertReferenceMatchesManifest(
        deriveRunnerReleaseId(digest),
        verifiedManifest,
      ),
    ).not.toThrow();
    expect(() =>
      assertReferenceMatchesManifest('1.2.4', verifiedManifest),
    ).toThrow(/does not match/);
  });
});

describe('safe partial resume', () => {
  it('starts new, resumes only strong matching identity, and verifies complete bytes', () => {
    const base = {
      actualBytes: 0,
      sourceId: source.sourceId,
      manifestSha256: digest,
      artifact,
    };
    expect(decidePartialDownload({ ...base, partial: null })).toEqual({
      action: 'start_new',
      offset: 0,
    });
    expect(
      decidePartialDownload({ ...base, partial: partial(), actualBytes: 40 }),
    ).toEqual({ action: 'resume', offset: 40, etag: '"artifact-v1"' });
    expect(
      decidePartialDownload({
        ...base,
        partial: partial({ downloadedBytes: 100 }),
        actualBytes: 100,
      }),
    ).toEqual({ action: 'verify_complete', offset: 100 });
  });

  it('discards mismatched, weak, or non-range partial state', () => {
    const base = {
      actualBytes: 40,
      sourceId: source.sourceId,
      manifestSha256: digest,
      artifact,
    };
    expect(
      decidePartialDownload({
        ...base,
        partial: partial({ rangeSupported: false }),
      }),
    ).toEqual({ action: 'discard_restart', offset: 0 });
    expect(
      decidePartialDownload({ ...base, partial: partial(), actualBytes: 39 }),
    ).toEqual({ action: 'discard_restart', offset: 0 });
    expect(() => partial({ strongEtag: 'W/"weak"' })).toThrow();
  });

  it('accepts only an exact 206 response for resume', () => {
    expect(() =>
      assertResumeResponse({
        statusCode: 206,
        contentRange: 'bytes 40-99/100',
        contentLength: 60,
        etag: '"artifact-v1"',
        expectedEtag: '"artifact-v1"',
        offset: 40,
        expectedSize: 100,
      }),
    ).not.toThrow();
    expect(() =>
      assertResumeResponse({
        statusCode: 200,
        contentRange: undefined,
        contentLength: 100,
        etag: '"artifact-v1"',
        expectedEtag: '"artifact-v1"',
        offset: 40,
        expectedSize: 100,
      }),
    ).toThrow(/identity changed/);
    expect(() =>
      assertResumeResponse({
        statusCode: 206,
        contentRange: 'bytes 41-99/100',
        contentLength: 59,
        etag: '"artifact-v1"',
        expectedEtag: '"artifact-v1"',
        offset: 40,
        expectedSize: 100,
      }),
    ).toThrow(/range/);
  });
});

describe('cache contracts and independence', () => {
  it('binds cache records to signed identity and exposes a path-free summary', () => {
    const record = CachedRunnerReleaseSchema.parse({
      schemaVersion: 1,
      sourceId: source.sourceId,
      releaseId: deriveRunnerReleaseId(digest),
      manifestSha256: digest,
      version: manifest.version,
      artifact,
      verifiedAt: '2026-08-12T00:01:00.000Z',
    });
    expect(summarizeCachedRelease(record)).toEqual({
      releaseId: deriveRunnerReleaseId(digest),
      version: '1.2.3',
      target: 'windows/x64',
      verifiedAt: '2026-08-12T00:01:00.000Z',
    });
    expect(JSON.stringify(summarizeCachedRelease(record))).not.toMatch(
      /path|etag|sha256|signature|source/i,
    );
    expect(MAX_RELEASE_ARTIFACT_BYTES).toBe(4 * 1024 * 1024 * 1024);
  });

  it('allows only deterministic acquisition transitions', () => {
    expect(() =>
      assertReleaseAcquisitionTransition('idle', 'metadata_verified'),
    ).not.toThrow();
    expect(() =>
      assertReleaseAcquisitionTransition('metadata_verified', 'verified'),
    ).not.toThrow();
    expect(() =>
      assertReleaseAcquisitionTransition('idle', 'verified'),
    ).toThrow();
  });

  it('has no framework, network, filesystem, crypto, or process imports', () => {
    const sourceDirectory = fileURLToPath(new URL('../src/', import.meta.url));
    const productionSource = readdirSync(sourceDirectory)
      .filter((fileName) => fileName.endsWith('.ts'))
      .map((fileName) => readFileSync(`${sourceDirectory}/${fileName}`, 'utf8'))
      .join('\n');
    expect(productionSource).not.toMatch(
      /(?:from|import\()\s*['"](?:node:|@nestjs|@prisma|react|next|playwright)/,
    );
    expect(productionSource).not.toMatch(
      /child_process|powershell|shellCommand|downloadUrl|artifactPath|localPath/,
    );
  });
});
