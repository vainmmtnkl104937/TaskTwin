import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ComponentHeartbeatRepository } from '@tasktwin/database';
import {
  COMPONENT_HEARTBEAT_INTERVAL_SECONDS,
  type OperationalComponentType,
} from '@tasktwin/operational-telemetry';

export class ComponentHeartbeatReporter {
  private readonly logger: Logger;
  private readonly processInstanceId = randomUUID();
  private interval: NodeJS.Timeout | null = null;
  private registered = false;

  constructor(
    private readonly repository: ComponentHeartbeatRepository,
    private readonly componentType: OperationalComponentType,
  ) {
    this.logger = new Logger(`Heartbeat:${componentType}`);
  }

  async start(): Promise<void> {
    if (this.interval !== null) return;
    try {
      await this.repository.register({
        processInstanceId: this.processInstanceId,
        componentType: this.componentType,
      });
      this.registered = true;
    } catch {
      this.logger.warn('TELEMETRY_STORAGE_UNAVAILABLE');
    }
    this.interval = setInterval(() => {
      void this.refresh();
    }, COMPONENT_HEARTBEAT_INTERVAL_SECONDS * 1_000);
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
      this.logger.warn('TELEMETRY_STORAGE_UNAVAILABLE');
    } finally {
      this.registered = false;
    }
  }

  private async refresh(): Promise<void> {
    if (!this.registered) {
      try {
        await this.repository.register({
          processInstanceId: this.processInstanceId,
          componentType: this.componentType,
        });
        this.registered = true;
      } catch {
        this.logger.warn('TELEMETRY_STORAGE_UNAVAILABLE');
      }
      return;
    }
    try {
      const refreshed = await this.repository.refresh(this.processInstanceId);
      if (!refreshed) this.registered = false;
    } catch {
      this.logger.warn('TELEMETRY_STORAGE_UNAVAILABLE');
    }
  }
}
