import {
  ProductSemVerSchema,
  ReleaseArtifactDescriptorSchema,
  RunnerReleaseIdSchema,
  Sha256HexSchema,
  deriveRunnerReleaseId,
} from '@tasktwin/runner-release';
import { z } from 'zod';

import {
  DEFAULT_RELEASE_ARTIFACT_TIMEOUT_MS,
  DEFAULT_RELEASE_CONNECT_TIMEOUT_MS,
  DEFAULT_RELEASE_METADATA_TIMEOUT_MS,
  DEFAULT_RELEASE_READ_TIMEOUT_MS,
  RUNNER_ACQUISITION_SCHEMA_VERSION,
} from './constants.js';

const NormalizedTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => new Date(value).toISOString() === value);

export const TrustedReleaseSourceIdSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/);

export const TrustedReleaseOriginSchema = z
  .string()
  .superRefine((value, ctx) => {
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username !== '' ||
        url.password !== '' ||
        url.pathname !== '/' ||
        url.search !== '' ||
        url.hash !== '' ||
        url.origin !== value
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Origin must be normalized HTTPS.',
        });
      }
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'Origin must be a valid HTTPS origin.',
      });
    }
  });

export const TrustedReleasePathPrefixSchema = z
  .string()
  .regex(/^\/(?:[a-z0-9._-]+\/)*[a-z0-9._-]+$/)
  .max(256)
  .refine(
    (value) =>
      value.split('/').every((segment) => segment !== '.' && segment !== '..'),
    'Path prefix cannot contain dot segments.',
  );

export const TrustedReleaseSourceSchema = z.strictObject({
  sourceId: TrustedReleaseSourceIdSchema,
  origin: TrustedReleaseOriginSchema,
  pathPrefix: TrustedReleasePathPrefixSchema,
});

export const RunnerReleaseReferenceSchema = z.union([
  ProductSemVerSchema,
  RunnerReleaseIdSchema,
]);

export const ReleaseAcquisitionTimeoutsSchema = z.strictObject({
  connectMilliseconds: z.number().int().min(1_000).max(60_000),
  readMilliseconds: z.number().int().min(1_000).max(300_000),
  metadataRequestMilliseconds: z.number().int().min(1_000).max(300_000),
  artifactRequestMilliseconds: z
    .number()
    .int()
    .min(10_000)
    .max(2 * 60 * 60 * 1_000),
});

export const DEFAULT_RELEASE_ACQUISITION_TIMEOUTS =
  ReleaseAcquisitionTimeoutsSchema.parse({
    connectMilliseconds: DEFAULT_RELEASE_CONNECT_TIMEOUT_MS,
    readMilliseconds: DEFAULT_RELEASE_READ_TIMEOUT_MS,
    metadataRequestMilliseconds: DEFAULT_RELEASE_METADATA_TIMEOUT_MS,
    artifactRequestMilliseconds: DEFAULT_RELEASE_ARTIFACT_TIMEOUT_MS,
  });

export const StrongEntityTagSchema = z
  .string()
  .min(2)
  .max(256)
  .regex(/^"[!#-~]*"$/, 'A strong quoted ASCII entity tag is required.');

export const PartialReleaseAcquisitionSchema = z
  .strictObject({
    schemaVersion: z.literal(RUNNER_ACQUISITION_SCHEMA_VERSION),
    sourceId: TrustedReleaseSourceIdSchema,
    releaseId: RunnerReleaseIdSchema,
    manifestSha256: Sha256HexSchema,
    version: ProductSemVerSchema,
    artifact: ReleaseArtifactDescriptorSchema,
    strongEtag: StrongEntityTagSchema.nullable(),
    rangeSupported: z.boolean(),
    downloadedBytes: z.number().int().nonnegative(),
    createdAt: NormalizedTimestampSchema,
    updatedAt: NormalizedTimestampSchema,
  })
  .superRefine((record, context) => {
    if (record.releaseId !== deriveRunnerReleaseId(record.manifestSha256)) {
      context.addIssue({
        code: 'custom',
        message: 'Release identity must match the manifest digest.',
        path: ['releaseId'],
      });
    }
    if (record.downloadedBytes > record.artifact.sizeBytes) {
      context.addIssue({
        code: 'custom',
        message: 'Partial bytes cannot exceed the signed artifact size.',
        path: ['downloadedBytes'],
      });
    }
  });

export const CachedRunnerReleaseSchema = z
  .strictObject({
    schemaVersion: z.literal(RUNNER_ACQUISITION_SCHEMA_VERSION),
    sourceId: TrustedReleaseSourceIdSchema,
    releaseId: RunnerReleaseIdSchema,
    manifestSha256: Sha256HexSchema,
    version: ProductSemVerSchema,
    artifact: ReleaseArtifactDescriptorSchema,
    verifiedAt: NormalizedTimestampSchema,
  })
  .superRefine((record, context) => {
    if (record.releaseId !== deriveRunnerReleaseId(record.manifestSha256)) {
      context.addIssue({
        code: 'custom',
        message: 'Cached release identity must match the manifest digest.',
        path: ['releaseId'],
      });
    }
  });

export const ReleaseAcquisitionStateSchema = z.enum([
  'idle',
  'metadata_verified',
  'downloading',
  'partial',
  'verified',
  'failed',
]);

export type TrustedReleaseSource = z.infer<typeof TrustedReleaseSourceSchema>;
export type RunnerReleaseReference = z.infer<
  typeof RunnerReleaseReferenceSchema
>;
export type ReleaseAcquisitionTimeouts = z.infer<
  typeof ReleaseAcquisitionTimeoutsSchema
>;
export type PartialReleaseAcquisition = z.infer<
  typeof PartialReleaseAcquisitionSchema
>;
export type CachedRunnerRelease = z.infer<typeof CachedRunnerReleaseSchema>;
export type ReleaseAcquisitionState = z.infer<
  typeof ReleaseAcquisitionStateSchema
>;
