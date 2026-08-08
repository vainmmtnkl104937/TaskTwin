import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ComponentHeartbeatRepository } from '@tasktwin/database';

import { ComponentHeartbeatReporter } from './component-heartbeat.reporter.js';

@Injectable()
export class ApiHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly reporter: ComponentHeartbeatReporter;

  constructor(repository: ComponentHeartbeatRepository) {
    this.reporter = new ComponentHeartbeatReporter(
      repository,
      'control_plane_api',
    );
  }

  async onModuleInit(): Promise<void> {
    await this.reporter.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.reporter.stop();
  }
}
