import type { Page } from 'playwright';
import type { SafeExecutionError } from '@tasktwin/workflow-engine';

import type { BrowserExecutionOptions } from './contracts.js';

export interface BrowserSession {
  readonly page: Page;
  currentPageContextDigest(): string;
  close(): Promise<SafeExecutionError | null>;
}

export interface BrowserSessionFactory {
  create(options: BrowserExecutionOptions): Promise<BrowserSession>;
}
