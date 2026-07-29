import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { PrismaClient } from '@tasktwin/database';

import { DATABASE_CLIENT } from './database.constants.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(DATABASE_CLIENT)
    private readonly client: PrismaClient,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.client.$connect();
    } catch {
      // Startup continues so the readiness endpoint can report unavailability.
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
