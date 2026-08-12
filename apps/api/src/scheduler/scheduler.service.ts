import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  ComponentHeartbeatRepository,
  WorkflowApprovalRepository,
  WorkflowRunRepository,
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
  private readonly DISPATCH_CONCURRENCY = 10;

  constructor(
    private readonly repository: WorkflowScheduleRepository,
    heartbeatRepository: ComponentHeartbeatRepository,
    private readonly approvals?: WorkflowApprovalRepository,
    private readonly runs?: WorkflowRunRepository,
  ) {
    this.heartbeat = new ComponentHeartbeatReporter(
      heartbeatRepository,
      'scheduler',
    );
  }

  async onModuleInit(): Promise<void> {
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
      await this.runs?.reconcileExpiredLeases(now);
      await this.approvals?.reconcileExpired(now);
    } catch {
      this.logger.error('SCHEDULER_RECONCILE_EXPIRY_FAILED');
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

    for (
      let offset = 0;
      offset < schedules.length;
      offset += this.DISPATCH_CONCURRENCY
    ) {
      const batch = schedules.slice(offset, offset + this.DISPATCH_CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (schedule) => {
          try {
            const result = await this.repository.processOccurrence({
              scheduleId: schedule.scheduleId,
              now,
            });
            if (result === null) {
              return;
            }
            this.logger.log(
              result.skipReason === undefined
                ? 'SCHEDULER_OCCURRENCE_DISPATCHED'
                : 'SCHEDULER_OCCURRENCE_SKIPPED',
            );
          } catch {
            this.logger.error('SCHEDULER_OCCURRENCE_FAILED');
          }
        }),
      );
    }

  }

  private async reconcileTimedOutOccurrences(now: Date): Promise<void> {
    const count = await this.repository.reconcileTimedOutOccurrences(now);
    if (count > 0) {
      this.logger.log(`Reconciled ${count} timed-out occurrence(s)`);
    }
  }
}
