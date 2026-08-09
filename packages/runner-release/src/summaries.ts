import { ReleaseManifestSchema, type ReleaseManifest } from './contracts.js';
import {
  UpgradePreflightResultSchema,
  type UpgradePreflightResult,
} from './preflight.js';

export interface SafeReleaseSummary {
  product: string;
  version: string;
  channel: 'stable';
  sourceCommit: string;
  targets: string[];
  runnerProtocolVersion: number;
  workflowSchemaRange: string;
  localStateSchemas: number[];
  localSecretVaultSchemas: number[];
}

export function summarizeRelease(input: ReleaseManifest): SafeReleaseSummary {
  const manifest = ReleaseManifestSchema.parse(input);
  return {
    product: manifest.product,
    version: manifest.version,
    channel: manifest.channel,
    sourceCommit: manifest.sourceCommit,
    targets: manifest.artifacts.map(
      (artifact) => `${artifact.platform}/${artifact.architecture}`,
    ),
    runnerProtocolVersion: manifest.compatibility.runnerProtocolVersion,
    workflowSchemaRange: `${manifest.compatibility.workflowSchema.readable.min}-${manifest.compatibility.workflowSchema.readable.max}`,
    localStateSchemas: [...manifest.compatibility.localState.readableSchemas],
    localSecretVaultSchemas: [
      ...manifest.compatibility.localSecretVault.readableSchemas,
    ],
  };
}

export function summarizeUpgradePreflight(
  input: UpgradePreflightResult,
): UpgradePreflightResult {
  return UpgradePreflightResultSchema.parse(input);
}
