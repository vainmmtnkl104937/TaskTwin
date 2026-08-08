import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  ComponentHeartbeatRepository,
  WorkflowScheduleRepository,
} from '@tasktwin/database';

import { ComponentHeartbeatReporter } from '../operational-telemetry/component-heartbeat.reporter.js';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private interval: NodeJS.Timeout | null = null;
  private activeTick: Promise<void> | null = null;
  private readonly heartbeat: ComponentHeartbeatReporter;
  private enabled = false;
  private readonly POLL_INTERVAL_MS = 30_000;

  constructor(
    private readonly repository: WorkflowScheduleRepository,
    heartbeatRepository: ComponentHeartbeatRepository,
  ) {
    this.heartbeat = new ComponentHeartbeatReporter(
      heartbeatRepository,
      'scheduler',
    );
  }

  async onModuleInit(): Promise<void> {
    const enabled = process.env['SCHEDULER_ENABLED'] === 'true';
    if (!enabled) {
      this.logger.log('Scheduler is disabled via SCHEDULER_ENABLED env var');
      return;
    }

    this.enabled = true;
    await this.heartbeat.start();
    this.logger.log('Starting scheduler polling loop');
    this.interval = setInterval(() => {
      this.startTick();
    }, this.POLL_INTERVAL_MS);
    this.interval.unref();

    this.startTick();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
      this.logger.log('Scheduler polling loop stopped');
    }
    this.enabled = false;
    await this.activeTick;
    await this.heartbeat.stop();
  }

  private startTick(): void {
    if (!this.enabled || this.activeTick !== null) return;
    const tick = this.tick()
      .catch(() => this.logger.error('SCHEDULER_TICK_FAILED'))
      .finally(() => {
        if (this.activeTick === tick) this.activeTick = null;
      });
    this.activeTick = tick;
  }

  private async tick(): Promise<void> {
    const now = new Date();
    this.logger.debug(`Scheduler tick at ${now.toISOString()}`);

    try {
      await this.processDueSchedules(now);
    } catch {
      this.logger.error('SCHEDULER_PROCESS_DUE_FAILED');
    }

    try {
      await this.reconcileTimedOutOccurrences(now);
    } catch {
      this.logger.error('SCHEDULER_RECONCILE_TIMEOUT_FAILED');
    }

    try {
      const count = await this.repository.reconcileTerminalOccurrences(now);
      if (count > 0)
        this.logger.log(`Reconciled ${count} terminal occurrence(s)`);
    } catch {
      this.logger.error('SCHEDULER_RECONCILE_TERMINAL_FAILED');
    }
  }

  private async processDueSchedules(now: Date): Promise<void> {
    const schedules = await this.repository.selectDueSchedules(now);

    if (schedules.length === 0) {
      return;
    }

    this.logger.log(`Processing ${schedules.length} due schedule(s)`);

    await Promise.allSettled(
      schedules.map(async (schedule) => {
        try {
          const result = await this.repository.processOccurrence({
            scheduleId: schedule.scheduleId,
            now,
          });
          if (result === null) {
            return;
          }
          if (result.skipReason !== undefined) {
            this.logger.log(
              `Schedule ${schedule.scheduleId} occurrence skipped: ${result.skipReason}`,
            );
          } else {
            this.logger.log(
              `Schedule ${schedule.scheduleId} occurrence dispatched (id: ${result.occurrence.id})`,
            );
          }
        } catch {
          this.logger.error('SCHEDULER_OCCURRENCE_FAILED');
        }
      }),
    );
  }

  private async reconcileTimedOutOccurrences(now: Date): Promise<void> {
    const count = await this.repository.reconcileTimedOutOccurrences(now);
    if (count > 0) {
      this.logger.log(`Reconciled ${count} timed-out occurrence(s)`);
    }
  }
}
