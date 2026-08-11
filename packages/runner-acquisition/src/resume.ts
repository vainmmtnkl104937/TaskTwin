import type { ReleaseArtifactDescriptor } from '@tasktwin/runner-release';

import {
  PartialReleaseAcquisitionSchema,
  StrongEntityTagSchema,
  type PartialReleaseAcquisition,
} from './contracts.js';
import { RunnerAcquisitionError } from './errors.js';

export type PartialDownloadDecision =
  | { readonly action: 'start_new'; readonly offset: 0 }
  | {
      readonly action: 'resume';
      readonly offset: number;
      readonly etag: string;
    }
  | { readonly action: 'verify_complete'; readonly offset: number }
  | { readonly action: 'discard_restart'; readonly offset: 0 };

export function decidePartialDownload(input: {
  partial: PartialReleaseAcquisition | null;
  actualBytes: number;
  sourceId: string;
  manifestSha256: string;
  artifact: ReleaseArtifactDescriptor;
}): PartialDownloadDecision {
  if (input.partial === null) return { action: 'start_new', offset: 0 };
  const partial = PartialReleaseAcquisitionSchema.parse(input.partial);
  const matches =
    partial.sourceId === input.sourceId &&
    partial.manifestSha256 === input.manifestSha256 &&
    partial.artifact.fileName === input.artifact.fileName &&
    partial.artifact.sizeBytes === input.artifact.sizeBytes &&
    partial.artifact.sha256 === input.artifact.sha256 &&
    partial.downloadedBytes === input.actualBytes;
  if (
    !matches ||
    input.actualBytes < 0 ||
    input.actualBytes > input.artifact.sizeBytes
  ) {
    return { action: 'discard_restart', offset: 0 };
  }
  if (input.actualBytes === input.artifact.sizeBytes) {
    return { action: 'verify_complete', offset: input.actualBytes };
  }
  if (input.actualBytes === 0) return { action: 'start_new', offset: 0 };
  if (
    partial.rangeSupported &&
    partial.strongEtag !== null &&
    StrongEntityTagSchema.safeParse(partial.strongEtag).success
  ) {
    return {
      action: 'resume',
      offset: input.actualBytes,
      etag: partial.strongEtag,
    };
  }
  return { action: 'discard_restart', offset: 0 };
}

export function parseContentRange(value: string): {
  start: number;
  end: number;
  total: number;
} {
  const match = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/.exec(value);
  if (match === null) {
    throw new RunnerAcquisitionError(
      'acquisition_range_invalid',
      'The release source returned an invalid content range.',
    );
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    end < start ||
    total <= end
  ) {
    throw new RunnerAcquisitionError(
      'acquisition_range_invalid',
      'The release source returned an invalid content range.',
    );
  }
  return { start, end, total };
}

export function assertResumeResponse(input: {
  statusCode: number;
  contentRange: string | undefined;
  contentLength: number | undefined;
  etag: string | undefined;
  expectedEtag: string;
  offset: number;
  expectedSize: number;
}): void {
  if (input.statusCode !== 206 || input.etag !== input.expectedEtag) {
    throw new RunnerAcquisitionError(
      'acquisition_remote_identity_changed',
      'The remote release identity changed during resume.',
    );
  }
  const range = parseContentRange(input.contentRange ?? '');
  const remaining = input.expectedSize - input.offset;
  if (
    range.start !== input.offset ||
    range.end !== input.expectedSize - 1 ||
    range.total !== input.expectedSize ||
    (input.contentLength !== undefined && input.contentLength !== remaining)
  ) {
    throw new RunnerAcquisitionError(
      'acquisition_range_invalid',
      'The remote release range does not match the signed artifact.',
    );
  }
}
