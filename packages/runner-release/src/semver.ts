import semver from 'semver';
import { z } from 'zod';

import { MAX_RUNNER_RELEASE_VERSION_LENGTH } from './constants.js';

export function isCanonicalSemVer(value: string): boolean {
  try {
    const parsed = new semver.SemVer(value);
    const prerelease =
      parsed.prerelease.length === 0 ? '' : `-${parsed.prerelease.join('.')}`;
    const build = parsed.build.length === 0 ? '' : `+${parsed.build.join('.')}`;
    return (
      `${parsed.major}.${parsed.minor}.${parsed.patch}${prerelease}${build}` ===
      value
    );
  } catch {
    return false;
  }
}

export const ProductSemVerSchema = z
  .string()
  .min(1)
  .max(MAX_RUNNER_RELEASE_VERSION_LENGTH)
  .refine(isCanonicalSemVer, 'Version must be canonical SemVer.');

export function compareProductVersions(left: string, right: string): number {
  const parsedLeft = ProductSemVerSchema.parse(left);
  const parsedRight = ProductSemVerSchema.parse(right);
  return semver.compare(parsedLeft, parsedRight);
}

export function isStableProductVersion(value: string): boolean {
  const parsed = ProductSemVerSchema.safeParse(value);
  return parsed.success && semver.prerelease(parsed.data) === null;
}
