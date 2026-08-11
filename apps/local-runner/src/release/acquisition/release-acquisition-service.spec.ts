import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RunnerAcquisitionError,
  deriveReleaseMetadataUrls,
  type TrustedReleaseSource,
} from '@tasktwin/runner-acquisition';
import {
  ReleaseManifestSchema,
  ReleaseSignatureSchema,
  canonicalizeReleaseManifest,
  type TrustedReleaseKey,
} from '@tasktwin/runner-release';
import { describe, expect, it } from 'vitest';

import {
  LocalRunnerReleaseAcquisitionService,
  type ReleaseAcquisitionResult,
} from './release-acquisition-service.js';
import { FileReleaseCacheStore } from './release-cache-store.js';
import type {
  ReleaseHttpClient,
  ReleaseHttpRequest,
  ReleaseHttpResponse,
} from './https-release-client.js';

const source: TrustedReleaseSource = {
  sourceId: 'test-release-source',
  origin: 'https://releases.tasktwin.test',
  pathPrefix: '/runner/releases/v1',
};

interface HttpFixtureResponse {
  readonly statusCode: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly chunks?: readonly Uint8Array[];
  readonly errorAfterChunks?: unknown;
}

class FixtureHttpClient implements ReleaseHttpClient {
  readonly requests: ReleaseHttpRequest[] = [];

  constructor(
    private readonly respond: (
      input: ReleaseHttpRequest,
      requestNumber: number,
    ) => HttpFixtureResponse,
  ) {}

  async request(input: ReleaseHttpRequest): Promise<ReleaseHttpResponse> {
    this.requests.push(input);
    const fixture = this.respond(input, this.requests.length);
    const response = {
      statusCode: fixture.statusCode,
      headers: fixture.headers ?? {},
    };
    await input.onResponse(response);
    for (const chunk of fixture.chunks ?? []) await input.onChunk(chunk);
    if (fixture.errorAfterChunks !== undefined) throw fixture.errorAfterChunks;
    return response;
  }
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function releaseFixture() {
  const artifact = Buffer.from('signed-runner-release-artifact-for-session-34');
  const keyPair = generateKeyPairSync('ed25519');
  const keyId = 'runner-release-test-34';
  const manifest = ReleaseManifestSchema.parse({
    schemaVersion: 1,
    product: 'tasktwin-runner',
    version: '1.5.0',
    channel: 'stable',
    sourceCommit: 'd'.repeat(40),
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
    artifacts: [
      {
        platform: 'windows',
        architecture: 'x64',
        fileName: 'tasktwin-runner-1.5.0-windows-x64.zip',
        archiveFormat: 'zip',
        sizeBytes: artifact.byteLength,
        sha256: sha256(artifact),
      },
    ],
    signingKeyId: keyId,
  });
  const canonical = canonicalizeReleaseManifest(manifest);
  const signature = ReleaseSignatureSchema.parse({
    schemaVersion: 1,
    algorithm: 'Ed25519',
    keyId,
    manifestSha256: sha256(canonical),
    signature: sign(null, Buffer.from(canonical), keyPair.privateKey).toString(
      'base64url',
    ),
  });
  const trustedKey: TrustedReleaseKey = {
    keyId,
    algorithm: 'Ed25519',
    publicKeySpkiDerBase64Url: keyPair.publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64url'),
  };
  return {
    artifact,
    manifest,
    manifestBytes: Buffer.from(JSON.stringify(manifest)),
    signature,
    signatureBytes: Buffer.from(JSON.stringify(signature)),
    trustedKey,
  };
}

async function createService(
  trustedKey: TrustedReleaseKey,
  http: ReleaseHttpClient,
) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'tasktwin-acquisition-'));
  const cache = new FileReleaseCacheStore(dataRoot, [trustedKey]);
  const service = new LocalRunnerReleaseAcquisitionService(
    cache,
    [trustedKey],
    [source],
    { platform: 'windows', architecture: 'x64' },
    http,
    undefined,
    () => new Date('2026-08-12T01:00:00.000Z'),
  );
  return { cache, service };
}

function standardResponder(
  fixture: Awaited<ReturnType<typeof releaseFixture>>,
  artifactResponse?: (input: ReleaseHttpRequest) => HttpFixtureResponse,
) {
  const metadata = deriveReleaseMetadataUrls(source, fixture.manifest.version);
  return (input: ReleaseHttpRequest): HttpFixtureResponse => {
    if (input.url === metadata.manifestUrl) {
      return {
        statusCode: 200,
        headers: { 'content-length': String(fixture.manifestBytes.byteLength) },
        chunks: [fixture.manifestBytes],
      };
    }
    if (input.url === metadata.signatureUrl) {
      return {
        statusCode: 200,
        headers: {
          'content-length': String(fixture.signatureBytes.byteLength),
        },
        chunks: [fixture.signatureBytes],
      };
    }
    return (
      artifactResponse?.(input) ?? {
        statusCode: 200,
        headers: {
          'accept-ranges': 'bytes',
          'content-length': String(fixture.artifact.byteLength),
          etag: '"release-artifact-v1"',
        },
        chunks: [fixture.artifact],
      }
    );
  };
}

describe('Local Runner release acquisition', () => {
  it('verifies, atomically caches, and retries an exact release idempotently', async () => {
    const fixture = await releaseFixture();
    const http = new FixtureHttpClient(standardResponder(fixture));
    const { service } = await createService(fixture.trustedKey, http);

    const first = await service.acquire(fixture.manifest.version);
    const retry = await service.acquire(fixture.manifest.version);

    expect(first).toMatchObject({ idempotent: false });
    expect(retry).toEqual({ ...first, idempotent: true });
    expect(await service.list()).toEqual([first.release]);
    expect(await service.status()).toEqual({
      verifiedCount: 1,
      partialCount: 0,
    });
    expect(
      http.requests.filter((request) => request.url.endsWith('.zip')),
    ).toHaveLength(1);
    expect(JSON.stringify(first)).not.toMatch(
      /path|url|etag|signature|sha256/i,
    );
  });

  it('rejects an invalid signature before requesting an artifact', async () => {
    const fixture = await releaseFixture();
    const invalidSignature = Buffer.from(
      JSON.stringify({ ...fixture.signature, signature: 'AAAA' }),
    );
    const metadata = deriveReleaseMetadataUrls(
      source,
      fixture.manifest.version,
    );
    const http = new FixtureHttpClient((input) => {
      if (input.url === metadata.manifestUrl) {
        return { statusCode: 200, chunks: [fixture.manifestBytes] };
      }
      if (input.url === metadata.signatureUrl) {
        return { statusCode: 200, chunks: [invalidSignature] };
      }
      throw new Error(
        'Artifact request must not occur before trust verification.',
      );
    });
    const { service } = await createService(fixture.trustedKey, http);

    await expect(
      service.acquire(fixture.manifest.version),
    ).rejects.toMatchObject({
      code: 'release_signature_verification_failed',
    });
    expect(http.requests.some((request) => request.url.endsWith('.zip'))).toBe(
      false,
    );
    expect(await service.status()).toEqual({
      verifiedCount: 0,
      partialCount: 0,
    });
  });

  it('keeps interrupted bytes isolated and resumes only with an exact strong identity', async () => {
    const fixture = await releaseFixture();
    const splitAt = 17;
    let artifactRequest = 0;
    const http = new FixtureHttpClient(
      standardResponder(fixture, (input) => {
        artifactRequest += 1;
        if (artifactRequest === 1) {
          return {
            statusCode: 200,
            headers: {
              'accept-ranges': 'bytes',
              'content-length': String(fixture.artifact.byteLength),
              etag: '"release-artifact-v1"',
            },
            chunks: [fixture.artifact.subarray(0, splitAt)],
            errorAfterChunks: new RunnerAcquisitionError(
              'acquisition_read_timeout',
              'Simulated interrupted response.',
            ),
          };
        }
        expect(input.headers).toMatchObject({
          Range: `bytes=${splitAt}-`,
          'If-Range': '"release-artifact-v1"',
        });
        return {
          statusCode: 206,
          headers: {
            'content-length': String(fixture.artifact.byteLength - splitAt),
            'content-range': `bytes ${splitAt}-${fixture.artifact.byteLength - 1}/${fixture.artifact.byteLength}`,
            etag: '"release-artifact-v1"',
          },
          chunks: [fixture.artifact.subarray(splitAt)],
        };
      }),
    );
    const { service } = await createService(fixture.trustedKey, http);

    await expect(
      service.acquire(fixture.manifest.version),
    ).rejects.toMatchObject({
      code: 'acquisition_read_timeout',
    });
    expect(await service.status()).toEqual({
      verifiedCount: 0,
      partialCount: 1,
    });

    const result = await service.acquire(fixture.manifest.version);
    expect(result.idempotent).toBe(false);
    expect(await service.status()).toEqual({
      verifiedCount: 1,
      partialCount: 0,
    });
  });

  it('discards an unsafe resume response and performs one clean full download', async () => {
    const fixture = await releaseFixture();
    const splitAt = 11;
    let artifactRequest = 0;
    const http = new FixtureHttpClient(
      standardResponder(fixture, (input) => {
        artifactRequest += 1;
        if (artifactRequest === 1) {
          return {
            statusCode: 200,
            headers: {
              'accept-ranges': 'bytes',
              'content-length': String(fixture.artifact.byteLength),
              etag: '"release-artifact-v1"',
            },
            chunks: [fixture.artifact.subarray(0, splitAt)],
            errorAfterChunks: new RunnerAcquisitionError(
              'acquisition_read_timeout',
              'Simulated interrupted response.',
            ),
          };
        }
        if (input.headers?.Range !== undefined) {
          return {
            statusCode: 200,
            headers: {
              'content-length': String(fixture.artifact.byteLength),
              etag: '"changed-identity"',
            },
            chunks: [fixture.artifact],
          };
        }
        return {
          statusCode: 200,
          headers: { 'content-length': String(fixture.artifact.byteLength) },
          chunks: [fixture.artifact],
        };
      }),
    );
    const { service } = await createService(fixture.trustedKey, http);

    await expect(
      service.acquire(fixture.manifest.version),
    ).rejects.toMatchObject({
      code: 'acquisition_read_timeout',
    });
    await expect(
      service.acquire(fixture.manifest.version),
    ).resolves.toMatchObject({
      idempotent: false,
    } satisfies Partial<ReleaseAcquisitionResult>);
    expect(artifactRequest).toBe(3);
    expect(await service.status()).toEqual({
      verifiedCount: 1,
      partialCount: 0,
    });
  });

  it('removes checksum-mismatched bytes without promoting them', async () => {
    const fixture = await releaseFixture();
    const changed = Buffer.from(fixture.artifact);
    changed[0] = (changed[0] ?? 0) ^ 1;
    const http = new FixtureHttpClient(
      standardResponder(fixture, () => ({
        statusCode: 200,
        headers: { 'content-length': String(changed.byteLength) },
        chunks: [changed],
      })),
    );
    const { service } = await createService(fixture.trustedKey, http);

    await expect(
      service.acquire(fixture.manifest.version),
    ).rejects.toMatchObject({
      code: 'acquisition_cache_invalid',
    });
    expect(await service.status()).toEqual({
      verifiedCount: 0,
      partialCount: 0,
    });
  });
});
