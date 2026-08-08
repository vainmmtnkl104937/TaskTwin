import {
  WorkspaceOperationsSnapshotSchema,
  type WorkspaceOperationsSnapshot,
} from './contracts.js';
import { OperationalTelemetryError } from './errors.js';

const PROHIBITED_KEY_PATTERN =
  /(?:input|secret|password|credential|token|output|locator|url|uri|raw.?error|browser.?error|dom|html|screenshot|hostname|^ip$|ip.?address|os.?username|container.?id|filesystem.?path|environment|instance.?id|user.?id|runner.?id|workflow.?id|run.?id)/i;

export function assertTelemetrySafe(value: unknown): void {
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (typeof current !== 'object' || current === null) {
      return;
    }
    for (const [key, nested] of Object.entries(current)) {
      if (PROHIBITED_KEY_PATTERN.test(key)) {
        throw new OperationalTelemetryError('TELEMETRY_INVALID');
      }
      visit(nested);
    }
  };
  visit(value);
}

export function validateWorkspaceOperationsSnapshot(
  value: unknown,
): WorkspaceOperationsSnapshot {
  const result = WorkspaceOperationsSnapshotSchema.safeParse(value);
  if (!result.success) {
    throw new OperationalTelemetryError('TELEMETRY_SNAPSHOT_INVALID');
  }
  assertTelemetrySafe(result.data);
  return result.data;
}
