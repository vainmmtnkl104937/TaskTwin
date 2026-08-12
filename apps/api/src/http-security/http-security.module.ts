import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { ProductionExceptionFilter } from './production-exception.filter.js';
import { RedactingLogger } from './redacting-logger.service.js';
import { ScopedThrottleGuard } from './scoped-throttle.guard.js';
import { AuthenticatedRunnerThrottleGuard } from './authenticated-runner-throttle.guard.js';

@Global()
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'scoped', ttl: 60_000, limit: 1_000_000 }],
      setHeaders: false,
    }),
  ],
  providers: [
    RedactingLogger,
    ScopedThrottleGuard,
    AuthenticatedRunnerThrottleGuard,
    { provide: APP_GUARD, useExisting: ScopedThrottleGuard },
    {
      provide: APP_FILTER,
      inject: [RedactingLogger],
      useFactory: (logger: RedactingLogger) =>
        new ProductionExceptionFilter(logger),
    },
  ],
  exports: [RedactingLogger, AuthenticatedRunnerThrottleGuard],
})
export class HttpSecurityModule {}
