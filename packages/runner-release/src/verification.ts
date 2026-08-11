import { z } from 'zod';

import { canonicalizeReleaseManifest } from './canonical-manifest.js';
import {
  ReleaseManifestSchema,
  ReleaseSignatureSchema,
  RunnerReleaseArchitectureSchema,
  RunnerReleasePlatformSchema,
  Sha256HexSchema,
  TrustedReleaseKeySchema,
  type ReleaseArtifactDescriptor,
  type ReleaseManifest,
  type ReleaseSignature,
  type TrustedReleaseKey,
} from './contracts.js';
import { RunnerReleaseError } from './errors.js';

export interface ReleaseVerificationCrypto {
  sha256Hex(value: string): string;
  verifyEd25519(input: {
    canonicalManifest: string;
    signatureBase64Url: string;
    publicKeySpkiDerBase64Url: string;
  }): boolean;
}

export const ObservedReleaseArtifactSchema = z.strictObject({
  platform: RunnerReleasePlatformSchema,
  architecture: RunnerReleaseArchitectureSchema,
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: Sha256HexSchema,
});

export type ObservedReleaseArtifact = z.infer<
  typeof ObservedReleaseArtifactSchema
>;

export interface VerifyReleaseInput {
  manifest: unknown;
  signature: unknown;
  trustedKeys: readonly TrustedReleaseKey[];
  artifact: ObservedReleaseArtifact;
  crypto: ReleaseVerificationCrypto;
}

export interface VerifyReleaseManifestInput {
  manifest: unknown;
  signature: unknown;
  trustedKeys: readonly TrustedReleaseKey[];
  crypto: ReleaseVerificationCrypto;
}

export interface VerifiedReleaseManifest {
  manifest: ReleaseManifest;
  signature: ReleaseSignature;
  canonicalManifest: string;
  manifestSha256: string;
}

export interface VerifiedRelease {
  manifest: ReleaseManifest;
  signature: ReleaseSignature;
  artifact: ReleaseArtifactDescriptor;
  canonicalManifest: string;
  manifestSha256: string;
}

function equalAsciiConstantTime(left: string, right: string): boolean {
  const maximumLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maximumLength; index += 1) {
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function parseManifest(input: unknown): ReleaseManifest {
  const parsed = ReleaseManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new RunnerReleaseError(
      'release_manifest_invalid',
      'The release manifest is invalid.',
    );
  }
  return parsed.data;
}

function parseSignature(input: unknown): ReleaseSignature {
  const parsed = ReleaseSignatureSchema.safeParse(input);
  if (!parsed.success) {
    throw new RunnerReleaseError(
      'release_signature_invalid',
      'The detached release signature is invalid.',
    );
  }
  return parsed.data;
}

export function verifyReleaseManifest(
  input: VerifyReleaseManifestInput,
): VerifiedReleaseManifest {
  const manifest = parseManifest(input.manifest);
  const signature = parseSignature(input.signature);
  const trustedKeys = input.trustedKeys.map((key) =>
    TrustedReleaseKeySchema.parse(key),
  );

  if (manifest.signingKeyId !== signature.keyId) {
    throw new RunnerReleaseError(
      'release_signing_key_mismatch',
      'The manifest and signature signing key IDs do not match.',
    );
  }

  const trustedKey = trustedKeys.find((key) => key.keyId === signature.keyId);
  if (trustedKey === undefined) {
    throw new RunnerReleaseError(
      'release_signing_key_unknown',
      'The release signing key is not trusted.',
    );
  }

  const canonicalManifest = canonicalizeReleaseManifest(manifest);
  const manifestSha256 = Sha256HexSchema.parse(
    input.crypto.sha256Hex(canonicalManifest),
  );
  if (!equalAsciiConstantTime(manifestSha256, signature.manifestSha256)) {
    throw new RunnerReleaseError(
      'release_manifest_digest_mismatch',
      'The release manifest digest does not match the detached signature.',
    );
  }

  if (
    !input.crypto.verifyEd25519({
      canonicalManifest,
      signatureBase64Url: signature.signature,
      publicKeySpkiDerBase64Url: trustedKey.publicKeySpkiDerBase64Url,
    })
  ) {
    throw new RunnerReleaseError(
      'release_signature_verification_failed',
      'The release manifest signature is invalid.',
    );
  }

  return { manifest, signature, canonicalManifest, manifestSha256 };
}

export function verifyRelease(input: VerifyReleaseInput): VerifiedRelease {
  const verified = verifyReleaseManifest(input);
  const { manifest, signature, canonicalManifest, manifestSha256 } = verified;
  const artifact = ObservedReleaseArtifactSchema.parse(input.artifact);

  const descriptor = manifest.artifacts.find(
    (candidate) =>
      candidate.platform === artifact.platform &&
      candidate.architecture === artifact.architecture,
  );
  if (descriptor === undefined) {
    throw new RunnerReleaseError(
      'release_artifact_not_declared',
      'The release does not declare an artifact for this target.',
    );
  }
  if (descriptor.fileName !== artifact.fileName) {
    throw new RunnerReleaseError(
      'release_artifact_name_mismatch',
      'The artifact file name does not match the signed descriptor.',
    );
  }
  if (descriptor.sizeBytes !== artifact.sizeBytes) {
    throw new RunnerReleaseError(
      'release_artifact_size_mismatch',
      'The artifact size does not match the signed descriptor.',
    );
  }
  if (!equalAsciiConstantTime(descriptor.sha256, artifact.sha256)) {
    throw new RunnerReleaseError(
      'release_artifact_hash_mismatch',
      'The artifact checksum does not match the signed descriptor.',
    );
  }

  return {
    manifest,
    signature,
    artifact: descriptor,
    canonicalManifest,
    manifestSha256,
  };
}
