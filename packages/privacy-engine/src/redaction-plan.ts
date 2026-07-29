import {
  RedactionPlanSchema,
  RedactionRegionCandidateSchema,
  RedactionViewportSchema,
  type RedactionPlan,
  type PrivacyRuleId,
  type RedactionRegion,
  type RedactionRegionCandidate,
  type RedactionViewport,
  type Sensitivity,
} from './contracts.js';
import {
  MAX_REDACTION_REGIONS,
  SIGNIFICANT_OVERLAP_RATIO,
} from './constants.js';
import { SENSITIVITY_PRIORITY } from './rules.js';

interface NormalizedRegion {
  sourceIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  sensitivity: Sensitivity;
  reasons: PrivacyRuleId[];
}

function canonicalNumber(value: number): number {
  const rounded = Math.round(value * 1_000) / 1_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clamp(value: number, maximum: number): number {
  return Math.min(Math.max(value, 0), maximum);
}

function normalizeRegion(
  candidate: RedactionRegionCandidate,
  viewport: RedactionViewport,
): NormalizedRegion {
  const initialRight = candidate.x + candidate.width;
  const initialBottom = candidate.y + candidate.height;
  const left = clamp(Math.min(candidate.x, initialRight), viewport.width);
  const right = clamp(Math.max(candidate.x, initialRight), viewport.width);
  const top = clamp(Math.min(candidate.y, initialBottom), viewport.height);
  const bottom = clamp(Math.max(candidate.y, initialBottom), viewport.height);
  const width = canonicalNumber(right - left);
  const height = canonicalNumber(bottom - top);

  if (width <= 0 || height <= 0) {
    throw new Error('Redaction regions must have visible non-zero area.');
  }

  return {
    sourceIds: [candidate.id],
    x: canonicalNumber(left),
    y: canonicalNumber(top),
    width,
    height,
    sensitivity: candidate.sensitivity,
    reasons: [...new Set(candidate.reasons)].sort(),
  };
}

function area(region: NormalizedRegion): number {
  return region.width * region.height;
}

function intersectionArea(
  left: NormalizedRegion,
  right: NormalizedRegion,
): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y),
  );
  return width * height;
}

function significantlyOverlaps(
  left: NormalizedRegion,
  right: NormalizedRegion,
): boolean {
  const intersection = intersectionArea(left, right);
  return (
    intersection > 0 &&
    intersection / Math.min(area(left), area(right)) >=
      SIGNIFICANT_OVERLAP_RATIO
  );
}

function strongerSensitivity(
  left: Sensitivity,
  right: Sensitivity,
): Sensitivity {
  return SENSITIVITY_PRIORITY.indexOf(left) <=
    SENSITIVITY_PRIORITY.indexOf(right)
    ? left
    : right;
}

function merge(
  left: NormalizedRegion,
  right: NormalizedRegion,
): NormalizedRegion {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const farRight = Math.max(left.x + left.width, right.x + right.width);
  const bottom = Math.max(left.y + left.height, right.y + right.height);
  return {
    sourceIds: [...new Set([...left.sourceIds, ...right.sourceIds])].sort(),
    x: canonicalNumber(x),
    y: canonicalNumber(y),
    width: canonicalNumber(farRight - x),
    height: canonicalNumber(bottom - y),
    sensitivity: strongerSensitivity(left.sensitivity, right.sensitivity),
    reasons: [...new Set([...left.reasons, ...right.reasons])].sort(),
  };
}

function compareRegions(
  left: NormalizedRegion,
  right: NormalizedRegion,
): number {
  return (
    left.y - right.y ||
    left.x - right.x ||
    left.width - right.width ||
    left.height - right.height ||
    SENSITIVITY_PRIORITY.indexOf(left.sensitivity) -
      SENSITIVITY_PRIORITY.indexOf(right.sensitivity) ||
    left.sourceIds.join(':').localeCompare(right.sourceIds.join(':'))
  );
}

function mergeRegions(regions: NormalizedRegion[]): NormalizedRegion[] {
  const remaining = [...regions].sort(compareRegions);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (
      let leftIndex = 0;
      leftIndex < remaining.length;
      leftIndex += 1
    ) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < remaining.length;
        rightIndex += 1
      ) {
        const left = remaining[leftIndex];
        const right = remaining[rightIndex];
        if (
          left !== undefined &&
          right !== undefined &&
          significantlyOverlaps(left, right)
        ) {
          remaining.splice(leftIndex, 1, merge(left, right));
          remaining.splice(rightIndex, 1);
          remaining.sort(compareRegions);
          changed = true;
          break outer;
        }
      }
    }
  }
  return remaining.sort(compareRegions);
}

export function buildRedactionPlan(input: {
  viewport: RedactionViewport;
  generatedAt: string;
  candidates: readonly RedactionRegionCandidate[];
}): RedactionPlan {
  const viewport = RedactionViewportSchema.parse(input.viewport);
  if (input.candidates.length > MAX_REDACTION_REGIONS) {
    throw new Error(`Redaction region count exceeds ${MAX_REDACTION_REGIONS}.`);
  }
  const candidates = input.candidates.map((candidate) =>
    RedactionRegionCandidateSchema.parse(candidate),
  );
  const merged = mergeRegions(
    candidates.map((candidate) => normalizeRegion(candidate, viewport)),
  );

  const regions: RedactionRegion[] = merged.map((region, index) => ({
    id: `privacy-region-${String(index + 1)}`,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    mode: 'solid',
    sensitivity: region.sensitivity,
    reasons: region.reasons,
  }));

  return RedactionPlanSchema.parse({
    schemaVersion: 1,
    viewport,
    generatedAt: input.generatedAt,
    regions,
  });
}
