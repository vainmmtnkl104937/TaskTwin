import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';

import {
  CachedRunnerReleaseSchema,
  DEFAULT_RELEASE_ACQUISITION_TIMEOUTS,
  MAX_RELEASE_ARTIFACT_BYTES,
  MAX_RELEASE_MANIFEST_BYTES,
  MAX_RELEASE_SIGNATURE_BYTES,
  PartialReleaseAcquisitionSchema,
  ReleaseAcquisitionTimeoutsSchema,
  RunnerAcquisitionError,
  RunnerReleaseReferenceSchema,
  StrongEntityTagSchema,
  TrustedReleaseSourceSchema,
  assertReferenceMatchesManifest,
  assertResumeResponse,
  decidePartialDownload,
  deriveReleaseArtifactUrl,
  deriveReleaseMetadataUrls,
  summarizeCachedRelease,
  type PartialReleaseAcquisition,
  type ReleaseAcquisitionTimeouts,
  type RunnerReleaseReference,
  type SafeCachedReleaseSummary,
  type TrustedReleaseSource,
} from '@tasktwin/runner-acquisition';
import {
  RUNNER_RELEASE_ARCHITECTURE,
  RUNNER_RELEASE_PLATFORM,
  RunnerReleaseArchitectureSchema,
  RunnerReleasePlatformSchema,
  deriveRunnerReleaseId,
  verifyReleaseManifest,
  type ReleaseArtifactDescriptor,
  type RunnerReleaseArchitecture,
  type RunnerReleasePlatform,
  type TrustedReleaseKey,
  type VerifiedReleaseManifest,
} from '@tasktwin/runner-release';

import { nodeReleaseVerificationCrypto } from '../node-release-crypto.js';
import {
  FileReleaseCacheStore,
  type VerifiedCachedRelease,
} from './release-cache-store.js';
import {
  NodeHttpsReleaseClient,
  type ReleaseHttpClient,
  type ReleaseHttpResponse,
} from './https-release-client.js';

export interface ReleaseAcquisitionResult {
  readonly idempotent: boolean;
  readonly release: SafeCachedReleaseSummary;
}

export class LocalRunnerReleaseAcquisitionService {
  private readonly sources: readonly TrustedReleaseSource[];
  private readonly timeouts: ReleaseAcquisitionTimeouts;

  constructor(
    private readonly cache: FileReleaseCacheStore,
    private readonly trustedKeys: readonly TrustedReleaseKey[],
    sources: readonly TrustedReleaseSource[],
    private readonly target: {
      readonly platform: RunnerReleasePlatform;
      readonly architecture: RunnerReleaseArchitecture;
    } = {
      platform: RUNNER_RELEASE_PLATFORM,
      architecture: RUNNER_RELEASE_ARCHITECTURE,
    },
    private readonly http: ReleaseHttpClient = new NodeHttpsReleaseClient(),
    timeouts: ReleaseAcquisitionTimeouts = DEFAULT_RELEASE_ACQUISITION_TIMEOUTS,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.sources = sources.map((source) =>
      TrustedReleaseSourceSchema.parse(source),
    );
    if (
      new Set(this.sources.map((source) => source.sourceId)).size !==
      this.sources.length
    ) {
      throw new RunnerAcquisitionError(
        'acquisition_source_untrusted',
        'Trusted release source identifiers must be unique.',
      );
    }
    this.target = {
      platform: RunnerReleasePlatformSchema.parse(target.platform),
      architecture: RunnerReleaseArchitectureSchema.parse(target.architecture),
    };
    this.timeouts = ReleaseAcquisitionTimeoutsSchema.parse(timeouts);
  }

  async acquire(rawReference: string): Promise<ReleaseAcquisitionResult> {
    const reference = RunnerReleaseReferenceSchema.parse(rawReference);
    const source = this.sources[0];
    if (source === undefined) {
      throw new RunnerAcquisitionError(
        'acquisition_source_untrusted',
        'No trusted Runner release source is configured.',
      );
    }
    const urls = deriveReleaseMetadataUrls(source, reference);
    const [manifestBytes, signatureBytes] = await Promise.all([
      this.fetchMetadata(urls.manifestUrl, MAX_RELEASE_MANIFEST_BYTES),
      this.fetchMetadata(urls.signatureUrl, MAX_RELEASE_SIGNATURE_BYTES),
    ]);
    const verifiedManifest = verifyReleaseManifest({
      manifest: parseJson(manifestBytes),
      signature: parseJson(signatureBytes),
      trustedKeys: this.trustedKeys,
      crypto: nodeReleaseVerificationCrypto,
    });
    assertReferenceMatchesManifest(reference, verifiedManifest);
    const artifact = verifiedManifest.manifest.artifacts.find(
      (candidate) =>
        candidate.platform === this.target.platform &&
        candidate.architecture === this.target.architecture,
    );
    if (artifact === undefined) {
      throw new RunnerAcquisitionError(
        'acquisition_target_unsupported',
        'The signed release has no artifact for this Runner target.',
      );
    }
    if (artifact.sizeBytes > MAX_RELEASE_ARTIFACT_BYTES) {
      throw new RunnerAcquisitionError(
        'acquisition_artifact_too_large',
        'The signed release artifact exceeds the acquisition limit.',
      );
    }
    const cached = await this.cache.findVerified(
      verifiedManifest.manifestSha256,
    );
    if (cached !== null) {
      return {
        idempotent: true,
        release: summarizeCachedRelease(cached.record),
      };
    }
    const lease = await this.cache.acquire(verifiedManifest.manifestSha256);
    try {
      const afterLock = await this.cache.findVerified(
        verifiedManifest.manifestSha256,
      );
      if (afterLock !== null) {
        return {
          idempotent: true,
          release: summarizeCachedRelease(afterLock.record),
        };
      }
      const artifactUrl = deriveReleaseArtifactUrl({
        releaseDirectoryUrl: urls.releaseDirectoryUrl,
        artifactFileName: artifact.fileName,
        source,
      });
      const promoted = await this.acquireArtifact({
        reference,
        source,
        artifactUrl,
        artifact,
        verifiedManifest,
        manifestBytes,
        signatureBytes,
      });
      return {
        idempotent: false,
        release: summarizeCachedRelease(promoted.record),
      };
    } finally {
      await lease.release();
    }
  }

  list(): Promise<SafeCachedReleaseSummary[]> {
    return this.cache.list();
  }

  status(): Promise<{
    readonly verifiedCount: number;
    readonly partialCount: number;
  }> {
    return this.cache.status();
  }

  private async acquireArtifact(input: {
    reference: RunnerReleaseReference;
    source: TrustedReleaseSource;
    artifactUrl: string;
    artifact: ReleaseArtifactDescriptor;
    verifiedManifest: VerifiedReleaseManifest;
    manifestBytes: Uint8Array;
    signatureBytes: Uint8Array;
  }): Promise<VerifiedCachedRelease> {
    let observation;
    try {
      observation = await this.cache.observePartial(
        input.verifiedManifest.manifestSha256,
      );
    } catch {
      await this.cache.removePartial(input.verifiedManifest.manifestSha256);
      observation = await this.cache.observePartial(
        input.verifiedManifest.manifestSha256,
      );
    }
    const decision = decidePartialDownload({
      partial: observation.record,
      actualBytes: observation.actualBytes,
      sourceId: input.source.sourceId,
      manifestSha256: input.verifiedManifest.manifestSha256,
      artifact: input.artifact,
    });
    if (decision.action === 'verify_complete') {
      await this.cache.replacePartialProof({
        manifestSha256: input.verifiedManifest.manifestSha256,
        manifestBytes: input.manifestBytes,
        signatureBytes: input.signatureBytes,
      });
      return this.verifyAndPromote(input, observation.paths.artifact);
    }
    if (decision.action === 'resume' && observation.record !== null) {
      await this.cache.replacePartialProof({
        manifestSha256: input.verifiedManifest.manifestSha256,
        manifestBytes: input.manifestBytes,
        signatureBytes: input.signatureBytes,
      });
      try {
        await this.downloadArtifact({
          ...input,
          partial: observation.record,
          offset: decision.offset,
          expectedEtag: decision.etag,
        });
        return this.verifyAndPromote(input, observation.paths.artifact);
      } catch (error: unknown) {
        if (
          error instanceof RunnerAcquisitionError &&
          (error.code === 'acquisition_range_invalid' ||
            error.code === 'acquisition_remote_identity_changed')
        ) {
          await this.cache.removePartial(input.verifiedManifest.manifestSha256);
          return this.downloadFromStart(input);
        }
        throw error;
      }
    }
    await this.cache.removePartial(input.verifiedManifest.manifestSha256);
    return this.downloadFromStart(input);
  }

  private async downloadFromStart(input: {
    source: TrustedReleaseSource;
    artifactUrl: string;
    artifact: ReleaseArtifactDescriptor;
    verifiedManifest: VerifiedReleaseManifest;
    manifestBytes: Uint8Array;
    signatureBytes: Uint8Array;
  }): Promise<VerifiedCachedRelease> {
    const timestamp = this.timestamp();
    const record = PartialReleaseAcquisitionSchema.parse({
      schemaVersion: 1,
      sourceId: input.source.sourceId,
      releaseId: deriveRunnerReleaseId(input.verifiedManifest.manifestSha256),
      manifestSha256: input.verifiedManifest.manifestSha256,
      version: input.verifiedManifest.manifest.version,
      artifact: input.artifact,
      strongEtag: null,
      rangeSupported: false,
      downloadedBytes: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const paths = await this.cache.initializePartial({
      record,
      manifestBytes: input.manifestBytes,
      signatureBytes: input.signatureBytes,
    });
    await this.downloadArtifact({ ...input, partial: record, offset: 0 });
    return this.verifyAndPromote(input, paths.artifact);
  }

  private async downloadArtifact(input: {
    source: TrustedReleaseSource;
    artifactUrl: string;
    artifact: ReleaseArtifactDescriptor;
    verifiedManifest: VerifiedReleaseManifest;
    partial: PartialReleaseAcquisition;
    offset: number;
    expectedEtag?: string;
  }): Promise<void> {
    const paths = (
      await this.cache.observePartial(input.verifiedManifest.manifestSha256)
    ).paths;
    const digest = createHash('sha256');
    if (input.offset > 0) {
      let existingBytes = 0;
      for await (const chunk of createReadStream(paths.artifact)) {
        existingBytes += (chunk as Buffer).byteLength;
        digest.update(chunk as Buffer);
      }
      if (existingBytes !== input.offset) {
        throw new RunnerAcquisitionError(
          'acquisition_partial_invalid',
          'The partial release bytes changed before resume.',
        );
      }
    }
    const handle = await open(paths.artifact, 'r+');
    let downloadedBytes = input.offset;
    let record = input.partial;
    try {
      if (input.offset === 0) await handle.truncate(0);
      await this.http.request({
        url: input.artifactUrl,
        headers: {
          Accept: 'application/zip, application/octet-stream',
          'Accept-Encoding': 'identity',
          ...(input.expectedEtag === undefined
            ? {}
            : {
                Range: `bytes=${input.offset}-`,
                'If-Range': input.expectedEtag,
              }),
        },
        maximumBytes: input.artifact.sizeBytes - input.offset,
        maximumExceededCode: 'acquisition_artifact_too_large',
        totalTimeoutMilliseconds: this.timeouts.artifactRequestMilliseconds,
        timeouts: this.timeouts,
        onResponse: async (response) => {
          assertIdentityEncoding(response);
          const contentLength = optionalContentLength(response);
          if (input.expectedEtag !== undefined) {
            assertResumeResponse({
              statusCode: response.statusCode,
              contentRange: response.headers['content-range'],
              contentLength,
              etag: response.headers['etag'],
              expectedEtag: input.expectedEtag,
              offset: input.offset,
              expectedSize: input.artifact.sizeBytes,
            });
          } else {
            assertFullArtifactResponse(
              response,
              contentLength,
              input.artifact.sizeBytes,
            );
            const parsedEtag = StrongEntityTagSchema.safeParse(
              response.headers['etag'],
            );
            record = PartialReleaseAcquisitionSchema.parse({
              ...record,
              strongEtag: parsedEtag.success ? parsedEtag.data : null,
              rangeSupported:
                response.headers['accept-ranges']?.toLowerCase() === 'bytes',
              updatedAt: this.timestamp(),
            });
            await this.cache.updatePartial(record);
          }
        },
        onChunk: async (chunk) => {
          const nextDownloadedBytes = downloadedBytes + chunk.byteLength;
          if (nextDownloadedBytes > input.artifact.sizeBytes) {
            throw new RunnerAcquisitionError(
              'acquisition_artifact_too_large',
              'The downloaded artifact exceeds its signed size.',
            );
          }
          await writeAll(handle, chunk, downloadedBytes);
          digest.update(chunk);
          downloadedBytes = nextDownloadedBytes;
        },
      });
      await handle.sync();
    } finally {
      await handle.close().catch(() => undefined);
      const updated = PartialReleaseAcquisitionSchema.parse({
        ...record,
        downloadedBytes,
        updatedAt: this.timestamp(),
      });
      await this.cache.updatePartial(updated).catch(() => undefined);
    }
    if (downloadedBytes !== input.artifact.sizeBytes) {
      throw new RunnerAcquisitionError(
        'acquisition_response_invalid',
        'The downloaded artifact size does not match its signed descriptor.',
      );
    }
    if (digest.digest('hex') !== input.artifact.sha256) {
      await this.cache.removePartial(input.verifiedManifest.manifestSha256);
      throw new RunnerAcquisitionError(
        'acquisition_cache_invalid',
        'The downloaded artifact checksum does not match its signed descriptor.',
      );
    }
  }

  private async verifyAndPromote(
    input: {
      source: TrustedReleaseSource;
      artifact: ReleaseArtifactDescriptor;
      verifiedManifest: VerifiedReleaseManifest;
    },
    artifactPath: string,
  ): Promise<VerifiedCachedRelease> {
    const file = await lstat(artifactPath);
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      file.size !== input.artifact.sizeBytes
    ) {
      throw new RunnerAcquisitionError(
        'acquisition_partial_invalid',
        'The completed partial artifact is invalid.',
      );
    }
    const observedDigest = await sha256File(artifactPath);
    if (observedDigest !== input.artifact.sha256) {
      await this.cache.removePartial(input.verifiedManifest.manifestSha256);
      throw new RunnerAcquisitionError(
        'acquisition_cache_invalid',
        'The completed artifact checksum is invalid.',
      );
    }
    const record = CachedRunnerReleaseSchema.parse({
      schemaVersion: 1,
      sourceId: input.source.sourceId,
      releaseId: deriveRunnerReleaseId(input.verifiedManifest.manifestSha256),
      manifestSha256: input.verifiedManifest.manifestSha256,
      version: input.verifiedManifest.manifest.version,
      artifact: input.artifact,
      verifiedAt: this.timestamp(),
    });
    return this.cache.promote({
      verifiedManifest: input.verifiedManifest,
      record,
    });
  }

  private async fetchMetadata(
    url: string,
    maximumBytes: number,
  ): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    await this.http.request({
      url,
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
      },
      maximumBytes,
      maximumExceededCode: 'acquisition_metadata_too_large',
      totalTimeoutMilliseconds: this.timeouts.metadataRequestMilliseconds,
      timeouts: this.timeouts,
      onResponse: (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400) {
          throw new RunnerAcquisitionError(
            'acquisition_redirect_rejected',
            'Trusted release source redirects are not accepted.',
          );
        }
        if (response.statusCode !== 200) {
          throw new RunnerAcquisitionError(
            'acquisition_response_invalid',
            'The trusted release metadata response is invalid.',
          );
        }
        assertIdentityEncoding(response);
        const length = optionalContentLength(response);
        if (length !== undefined && length > maximumBytes) {
          throw new RunnerAcquisitionError(
            'acquisition_metadata_too_large',
            'The trusted release metadata exceeds its byte limit.',
          );
        }
      },
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
    });
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function assertIdentityEncoding(response: ReleaseHttpResponse): void {
  const encoding = response.headers['content-encoding'];
  if (encoding !== undefined && encoding.toLowerCase() !== 'identity') {
    throw new RunnerAcquisitionError(
      'acquisition_response_invalid',
      'Encoded trusted release responses are not accepted.',
    );
  }
}

function optionalContentLength(
  response: ReleaseHttpResponse,
): number | undefined {
  const value = response.headers['content-length'];
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new RunnerAcquisitionError(
      'acquisition_response_invalid',
      'The trusted release content length is invalid.',
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RunnerAcquisitionError(
      'acquisition_response_invalid',
      'The trusted release content length is invalid.',
    );
  }
  return parsed;
}

function assertFullArtifactResponse(
  response: ReleaseHttpResponse,
  contentLength: number | undefined,
  expectedSize: number,
): void {
  if (response.statusCode >= 300 && response.statusCode < 400) {
    throw new RunnerAcquisitionError(
      'acquisition_redirect_rejected',
      'Trusted release source redirects are not accepted.',
    );
  }
  if (
    response.statusCode !== 200 ||
    (contentLength !== undefined && contentLength !== expectedSize)
  ) {
    throw new RunnerAcquisitionError(
      'acquisition_response_invalid',
      'The trusted release artifact response is invalid.',
    );
  }
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new RunnerAcquisitionError(
      'acquisition_response_invalid',
      'The trusted release metadata is not valid JSON.',
    );
  }
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path))
    digest.update(chunk as Buffer);
  return digest.digest('hex');
}

async function writeAll(
  handle: FileHandle,
  chunk: Uint8Array,
  position: number,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await handle.write(
      chunk,
      offset,
      chunk.byteLength - offset,
      position + offset,
    );
    if (result.bytesWritten < 1) {
      throw new RunnerAcquisitionError(
        'acquisition_cache_invalid',
        'The partial release artifact could not be written safely.',
      );
    }
    offset += result.bytesWritten;
  }
}
