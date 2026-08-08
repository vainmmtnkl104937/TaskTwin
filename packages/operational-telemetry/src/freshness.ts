import {
  DEGRADED_HEARTBEAT_MAX_AGE_SECONDS,
  HEALTHY_HEARTBEAT_MAX_AGE_SECONDS,
} from './constants.js';
import type {
  ComponentHealthState,
  ComponentHealthSummary,
  ComponentHeartbeatSample,
  OperationalComponentType,
} from './contracts.js';

export function deriveComponentHealth(
  latestHeartbeatAt: Date | null,
  now: Date,
): ComponentHealthState {
  if (
    latestHeartbeatAt === null ||
    !Number.isFinite(latestHeartbeatAt.getTime())
  ) {
    return 'unknown';
  }
  const ageMilliseconds = now.getTime() - latestHeartbeatAt.getTime();
  if (!Number.isFinite(now.getTime()) || ageMilliseconds < 0) {
    return 'unknown';
  }
  if (ageMilliseconds <= HEALTHY_HEARTBEAT_MAX_AGE_SECONDS * 1_000) {
    return 'healthy';
  }
  if (ageMilliseconds <= DEGRADED_HEARTBEAT_MAX_AGE_SECONDS * 1_000) {
    return 'degraded';
  }
  return 'unavailable';
}

const HEALTH_PRIORITY: Readonly<Record<ComponentHealthState, number>> = {
  unknown: 0,
  unavailable: 1,
  degraded: 2,
  healthy: 3,
};

export function summarizeComponentHealth(input: {
  componentType: OperationalComponentType;
  samples: readonly ComponentHeartbeatSample[];
  now: Date;
}): ComponentHealthSummary {
  const matching = input.samples.filter(
    (sample) => sample.componentType === input.componentType,
  );
  if (matching.length === 0) {
    return { state: 'unknown', lastSeenAt: null };
  }

  let lastSeenAt: Date | null = null;
  let state: ComponentHealthState = 'unavailable';
  let hasRunningInstance = false;
  for (const sample of matching) {
    const heartbeat = new Date(sample.latestHeartbeatAt);
    if (
      Number.isFinite(heartbeat.getTime()) &&
      (lastSeenAt === null || heartbeat > lastSeenAt)
    ) {
      lastSeenAt = heartbeat;
    }
    if (sample.gracefulStoppedAt !== null) {
      continue;
    }
    hasRunningInstance = true;
    const candidate = deriveComponentHealth(heartbeat, input.now);
    if (HEALTH_PRIORITY[candidate] > HEALTH_PRIORITY[state]) {
      state = candidate;
    }
  }
  if (!hasRunningInstance) {
    state = 'unavailable';
  }
  return {
    state,
    lastSeenAt: lastSeenAt?.toISOString() ?? null,
  };
}
