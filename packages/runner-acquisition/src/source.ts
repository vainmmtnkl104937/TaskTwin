import {
  ProductSemVerSchema,
  RunnerReleaseIdSchema,
  type VerifiedReleaseManifest,
  deriveRunnerReleaseId,
} from '@tasktwin/runner-release';

import {
  RunnerReleaseReferenceSchema,
  TrustedReleaseSourceSchema,
  type RunnerReleaseReference,
  type TrustedReleaseSource,
} from './contracts.js';
import { RunnerAcquisitionError } from './errors.js';

export interface DerivedReleaseMetadataUrls {
  readonly releaseDirectoryUrl: string;
  readonly manifestUrl: string;
  readonly signatureUrl: string;
}

export function deriveReleaseMetadataUrls(
  rawSource: TrustedReleaseSource,
  rawReference: RunnerReleaseReference,
): DerivedReleaseMetadataUrls {
  const source = TrustedReleaseSourceSchema.parse(rawSource);
  const reference = RunnerReleaseReferenceSchema.parse(rawReference);
  const segment = encodeURIComponent(reference);
  const releaseDirectoryUrl = `${source.origin}${source.pathPrefix}/${segment}/`;
  return {
    releaseDirectoryUrl,
    manifestUrl: `${releaseDirectoryUrl}release-manifest.json`,
    signatureUrl: `${releaseDirectoryUrl}release-signature.json`,
  };
}

export function deriveReleaseArtifactUrl(input: {
  releaseDirectoryUrl: string;
  artifactFileName: string;
  source: TrustedReleaseSource;
}): string {
  const source = TrustedReleaseSourceSchema.parse(input.source);
  if (
    input.artifactFileName.length < 1 ||
    input.artifactFileName.length > 255 ||
    input.artifactFileName.includes('/') ||
    input.artifactFileName.includes('\\')
  ) {
    throw new RunnerAcquisitionError(
      'acquisition_url_invalid',
      'The signed artifact file name is invalid.',
    );
  }
  const candidate = new URL(
    encodeURIComponent(input.artifactFileName),
    input.releaseDirectoryUrl,
  );
  assertUrlWithinTrustedSource(candidate, source);
  return candidate.toString();
}

export function assertUrlWithinTrustedSource(
  rawUrl: URL | string,
  rawSource: TrustedReleaseSource,
): void {
  const source = TrustedReleaseSourceSchema.parse(rawSource);
  const url = typeof rawUrl === 'string' ? new URL(rawUrl) : rawUrl;
  const expectedPrefix = `${source.pathPrefix}/`;
  if (
    url.protocol !== 'https:' ||
    url.origin !== source.origin ||
    !url.pathname.startsWith(expectedPrefix) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new RunnerAcquisitionError(
      'acquisition_url_invalid',
      'The release URL is outside the trusted source.',
    );
  }
}

export function assertReferenceMatchesManifest(
  reference: RunnerReleaseReference,
  verified: VerifiedReleaseManifest,
): void {
  const parsed = RunnerReleaseReferenceSchema.parse(reference);
  const matches = ProductSemVerSchema.safeParse(parsed).success
    ? verified.manifest.version === parsed
    : RunnerReleaseIdSchema.parse(parsed) ===
      deriveRunnerReleaseId(verified.manifestSha256);
  if (!matches) {
    throw new RunnerAcquisitionError(
      'acquisition_reference_mismatch',
      'The verified manifest does not match the requested release reference.',
    );
  }
}
