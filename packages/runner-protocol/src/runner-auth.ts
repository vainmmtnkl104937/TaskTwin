import {
  RunnerAuthorizationPartsSchema,
  type RunnerAuthorizationParts,
} from './contracts.js';

const AUTHORIZATION_PATTERN = /^TaskTwinRunner ([^.]+)\.([^\s.]+)$/;

export function parseRunnerAuthorizationHeader(
  value: string | undefined,
): RunnerAuthorizationParts | null {
  if (value === undefined || value.length > 256) {
    return null;
  }
  const match = AUTHORIZATION_PATTERN.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) {
    return null;
  }
  const parsed = RunnerAuthorizationPartsSchema.safeParse({
    runnerDeviceId: match[1],
    credential: match[2],
  });
  return parsed.success ? parsed.data : null;
}
