import { ComponentHeartbeatRepository } from '@tasktwin/database';
import {
  COMPONENT_HEARTBEAT_INTERVAL_SECONDS,
  type OperationalComponentType,
} from '@tasktwin/operational-telemetry';

export class WorkerComponentHeartbeat {
  private interval: NodeJS.Timeout | null = null;
  private registered = false;

  constructor(
    private readonly repository: ComponentHeartbeatRepository,
    private readonly processInstanceId: string,
    private readonly componentType: OperationalComponentType,
  ) {}

  async start(): Promise<void> {
    await this.registerSafely();
    this.interval = setInterval(
      () => void this.refreshSafely(),
      COMPONENT_HEARTBEAT_INTERVAL_SECONDS * 1_000,
    );
    this.interval.unref();
  }

  async stop(): Promise<void> {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (!this.registered) return;
    try {
      await this.repository.stop(this.processInstanceId);
    } catch {
      console.warn('TELEMETRY_STORAGE_UNAVAILABLE');
    }
  }

  private async registerSafely(): Promise<void> {
    try {
      await this.repository.register({
        processInstanceId: this.processInstanceId,
        componentType: this.componentType,
      });
      this.registered = true;
    } catch {
      console.warn('TELEMETRY_STORAGE_UNAVAILABLE');
    }
  }

  private async refreshSafely(): Promise<void> {
    if (!this.registered) {
      await this.registerSafely();
      return;
    }
    try {
      const refreshed = await this.repository.refresh(this.processInstanceId);
      if (!refreshed) this.registered = false;
    } catch {
      console.warn('TELEMETRY_STORAGE_UNAVAILABLE');
    }
  }
}
