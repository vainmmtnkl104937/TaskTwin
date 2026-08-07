import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WorkflowScheduleRepository } from '@tasktwin/database';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private interval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 30_000;

  constructor(private readonly repository: WorkflowScheduleRepository) {}

  onModuleInit(): void {
    const enabled = process.env['SCHEDULER_ENABLED'] === 'true';
    if (!enabled) {
      this.logger.log('Scheduler is disabled via SCHEDULER_ENABLED env var');
      return;
    }

    this.logger.log('Starting scheduler polling loop');
    this.interval = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error('Scheduler tick failed', err);
      });
    }, this.POLL_INTERVAL_MS);

    this.tick().catch((err) => {
      this.logger.error('Initial scheduler tick failed', err);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
      this.logger.log('Scheduler polling loop stopped');
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();
    this.logger.debug(`Scheduler tick at ${now.toISOString()}`);

    try {
      await this.processDueSchedules(now);
    } catch (err) {
      this.logger.error('Failed to process due schedules', err);
    }

    try {
      await this.reconcileTimedOutOccurrences(now);
    } catch (err) {
      this.logger.error('Failed to reconcile timed-out occurrences', err);
    }

    try {
      const count = await this.repository.reconcileTerminalOccurrences(now);
      if (count > 0) this.logger.log(`Reconciled ${count} terminal occurrence(s)`);
    } catch (err) {
      this.logger.error('Failed to reconcile terminal occurrences', err);
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
        } catch (err) {
          this.logger.error(`Failed to process schedule ${schedule.scheduleId}`, err);
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
