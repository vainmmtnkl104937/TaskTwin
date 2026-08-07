export const MAX_DELIVERY_ATTEMPTS = 5;
export const RETRY_DELAYS_SECONDS = [15, 60, 300, 900] as const;

export function retryDelaySeconds(attemptCount: number): number | null {
  if (!Number.isInteger(attemptCount) || attemptCount < 1 || attemptCount >= MAX_DELIVERY_ATTEMPTS) {
    return null;
  }
  return RETRY_DELAYS_SECONDS[attemptCount - 1] ?? null;
}
