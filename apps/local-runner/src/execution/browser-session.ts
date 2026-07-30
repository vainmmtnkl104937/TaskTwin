import type { Page } from 'playwright';

import type {
  BrowserExecutionOptions,
  SafeExecutionError,
} from './contracts.js';

export interface BrowserSession {
  readonly page: Page;
  close(): Promise<SafeExecutionError | null>;
}

export interface BrowserSessionFactory {
  create(options: BrowserExecutionOptions): Promise<BrowserSession>;
}
