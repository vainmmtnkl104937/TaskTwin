import { z } from 'zod';

import {
  RUNNER_RELEASE_ARCHIVE_FORMAT,
  RUNNER_RELEASE_MANIFEST_SCHEMA_VERSION,
  RUNNER_RELEASE_PRODUCT,
  RUNNER_RELEASE_SIGNATURE_ALGORITHM,
  RUNNER_RELEASE_SIGNATURE_SCHEMA_VERSION,
} from './constants.js';
import { isStableProductVersion, ProductSemVerSchema } from './semver.js';

const PositiveSchemaVersionSchema = z
  .number()
  .int()
  .positive()
  .max(2_147_483_647);
const ReleaseKeyIdSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/);

export const RunnerReleasePlatformSchema = z.enum([
  'windows',
  'macos',
  'linux',
]);
export const RunnerReleaseArchitectureSchema = z.enum(['x64', 'arm64']);
export const RunnerReleaseChannelSchema = z.literal('stable');
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const SourceCommitSchema = z.string().regex(/^[0-9a-f]{40}$/);
export const ReleaseBase64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const RunnerSoftwareIdentitySchema = z.strictObject({
  product: z.literal(RUNNER_RELEASE_PRODUCT),
  version: ProductSemVerSchema,
  runnerProtocolVersion: PositiveSchemaVersionSchema,
  workflowSchemaVersion: PositiveSchemaVersionSchema,
  localStateSchemaVersion: PositiveSchemaVersionSchema,
  platform: RunnerReleasePlatformSchema,
  architecture: RunnerReleaseArchitectureSchema,
});

export const RunnerBuildIdentitySchema = RunnerSoftwareIdentitySchema.extend({
  sourceCommit: SourceCommitSchema,
  localSecretVaultSchemaVersion: PositiveSchemaVersionSchema,
}).strict();

export const WorkflowSchemaCompatibilitySchema = z
  .strictObject({
    readable: z.strictObject({
      min: PositiveSchemaVersionSchema,
      max: PositiveSchemaVersionSchema,
    }),
  })
  .superRefine((value, context) => {
    if (value.readable.min > value.readable.max) {
      context.addIssue({
        code: 'custom',
        message: 'Readable Workflow schema minimum cannot exceed maximum.',
        path: ['readable', 'min'],
      });
    }
  });

const OrderedUniqueSchemaVersionsSchema = z
  .array(PositiveSchemaVersionSchema)
  .min(1)
  .superRefine((values, context) => {
    for (let index = 1; index < values.length; index += 1) {
      const previous = values[index - 1];
      const current = values[index];
      if (
        previous === undefined ||
        current === undefined ||
        current <= previous
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Schema versions must be unique and ascending.',
          path: [index],
        });
      }
    }
  });

const VaultProtectionProfileSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/);

const PersistedSchemaCompatibilityObjectSchema = z.strictObject({
  readableSchemas: OrderedUniqueSchemaVersionsSchema,
  writableSchema: PositiveSchemaVersionSchema,
});

function requireWritableSchemaToBeReadable(
  value: z.infer<typeof PersistedSchemaCompatibilityObjectSchema>,
  context: z.RefinementCtx,
): void {
  if (!value.readableSchemas.includes(value.writableSchema)) {
    context.addIssue({
      code: 'custom',
      message: 'The writable schema must also be readable.',
      path: ['writableSchema'],
    });
  }
}

export const PersistedSchemaCompatibilitySchema =
  PersistedSchemaCompatibilityObjectSchema.superRefine(
    requireWritableSchemaToBeReadable,
  );

export const LocalSecretVaultCompatibilitySchema =
  PersistedSchemaCompatibilityObjectSchema.extend({
    readableProtectionProfiles: z
      .array(VaultProtectionProfileSchema)
      .min(1)
      .superRefine((values, context) => {
        const unique = new Set(values);
        if (unique.size !== values.length) {
          context.addIssue({
            code: 'custom',
            message: 'Vault protection profiles must be unique.',
          });
        }
        const sorted = [...values].sort();
        if (sorted.some((value, index) => value !== values[index])) {
          context.addIssue({
            code: 'custom',
            message: 'Vault protection profiles must be sorted.',
          });
        }
      }),
  })
    .strict()
    .superRefine(requireWritableSchemaToBeReadable);

export const ReleaseCompatibilityDeclarationSchema = z.strictObject({
  runnerProtocolVersion: PositiveSchemaVersionSchema,
  workflowSchema: WorkflowSchemaCompatibilitySchema,
  localState: PersistedSchemaCompatibilitySchema,
  localSecretVault: LocalSecretVaultCompatibilitySchema,
});

export const ReleaseArtifactDescriptorSchema = z.strictObject({
  platform: RunnerReleasePlatformSchema,
  architecture: RunnerReleaseArchitectureSchema,
  fileName: z
    .string()
    .min(1)
    .max(255)
    .refine(
      (value) =>
        !value.includes('/') &&
        !value.includes('\\') &&
        value !== '.' &&
        value !== '..',
      'Artifact file name must be a leaf file name.',
    ),
  archiveFormat: z.literal(RUNNER_RELEASE_ARCHIVE_FORMAT),
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sha256: Sha256HexSchema,
});

export function expectedRunnerArtifactFileName(
  version: string,
  platform: z.infer<typeof RunnerReleasePlatformSchema>,
  architecture: z.infer<typeof RunnerReleaseArchitectureSchema>,
): string {
  return `${RUNNER_RELEASE_PRODUCT}-${ProductSemVerSchema.parse(version)}-${platform}-${architecture}.zip`;
}

export const ReleaseManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(RUNNER_RELEASE_MANIFEST_SCHEMA_VERSION),
    product: z.literal(RUNNER_RELEASE_PRODUCT),
    version: ProductSemVerSchema,
    channel: RunnerReleaseChannelSchema,
    sourceCommit: SourceCommitSchema,
    builtAt: z.string().datetime({ offset: true }),
    compatibility: ReleaseCompatibilityDeclarationSchema,
    artifacts: z.array(ReleaseArtifactDescriptorSchema).min(1),
    signingKeyId: ReleaseKeyIdSchema,
  })
  .superRefine((manifest, context) => {
    if (!isStableProductVersion(manifest.version)) {
      context.addIssue({
        code: 'custom',
        message: 'Stable releases cannot use a prerelease version.',
        path: ['version'],
      });
    }

    const builtAt = new Date(manifest.builtAt);
    if (
      !Number.isFinite(builtAt.getTime()) ||
      builtAt.toISOString() !== manifest.builtAt
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Build timestamp must be normalized UTC ISO-8601.',
        path: ['builtAt'],
      });
    }

    const targets = new Set<string>();
    const fileNames = new Set<string>();
    manifest.artifacts.forEach((artifact, index) => {
      const target = `${artifact.platform}/${artifact.architecture}`;
      if (targets.has(target)) {
        context.addIssue({
          code: 'custom',
          message: 'Release artifact targets must be unique.',
          path: ['artifacts', index],
        });
      }
      targets.add(target);

      if (fileNames.has(artifact.fileName.toLowerCase())) {
        context.addIssue({
          code: 'custom',
          message: 'Release artifact file names must be unique.',
          path: ['artifacts', index, 'fileName'],
        });
      }
      fileNames.add(artifact.fileName.toLowerCase());

      const expectedFileName = expectedRunnerArtifactFileName(
        manifest.version,
        artifact.platform,
        artifact.architecture,
      );
      if (artifact.fileName !== expectedFileName) {
        context.addIssue({
          code: 'custom',
          message: `Artifact file name must be ${expectedFileName}.`,
          path: ['artifacts', index, 'fileName'],
        });
      }
    });
  });

export const ReleaseSignatureSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_RELEASE_SIGNATURE_SCHEMA_VERSION),
  algorithm: z.literal(RUNNER_RELEASE_SIGNATURE_ALGORITHM),
  keyId: ReleaseKeyIdSchema,
  manifestSha256: Sha256HexSchema,
  signature: ReleaseBase64UrlSchema.max(1024),
});

export const TrustedReleaseKeySchema = z.strictObject({
  keyId: ReleaseKeyIdSchema,
  algorithm: z.literal(RUNNER_RELEASE_SIGNATURE_ALGORITHM),
  publicKeySpkiDerBase64Url: ReleaseBase64UrlSchema.max(4096),
});

export type RunnerReleasePlatform = z.infer<typeof RunnerReleasePlatformSchema>;
export type RunnerReleaseArchitecture = z.infer<
  typeof RunnerReleaseArchitectureSchema
>;
export type RunnerSoftwareIdentity = z.infer<
  typeof RunnerSoftwareIdentitySchema
>;
export type RunnerBuildIdentity = z.infer<typeof RunnerBuildIdentitySchema>;
export type ReleaseCompatibilityDeclaration = z.infer<
  typeof ReleaseCompatibilityDeclarationSchema
>;
export type ReleaseArtifactDescriptor = z.infer<
  typeof ReleaseArtifactDescriptorSchema
>;
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;
export type ReleaseSignature = z.infer<typeof ReleaseSignatureSchema>;
export type TrustedReleaseKey = z.infer<typeof TrustedReleaseKeySchema>;
