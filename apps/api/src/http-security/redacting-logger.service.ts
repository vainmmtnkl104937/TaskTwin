import {
  ConsoleLogger,
  type ConsoleLoggerOptions,
  Injectable,
} from '@nestjs/common';

import { redactLogValue } from './redaction.js';

@Injectable()
export class RedactingLogger extends ConsoleLogger {
  constructor(options: ConsoleLoggerOptions = {}) {
    super({
      ...options,
      json: process.env.NODE_ENV === 'production',
      colors: process.env.NODE_ENV !== 'production',
      maxArrayLength: 20,
      maxStringLength: 512,
      depth: 4,
    });
  }

  protected override printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: Parameters<ConsoleLogger['isLevelEnabled']>[0],
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
  ): void {
    super.printMessages(
      messages.map((message) => redactLogValue(message)),
      context,
      logLevel,
      writeStreamType,
      errorStack === undefined ? undefined : 'STACK_REDACTED',
    );
  }
}
