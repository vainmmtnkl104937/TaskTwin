import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type ChromiumBrowser,
  type Page,
} from 'playwright';

import type {
  BrowserSession,
  BrowserSessionFactory,
} from './browser-session.js';
import type {
  BrowserExecutionOptions,
  SafeExecutionError,
} from './contracts.js';
import { SafeExecutionException, safeError } from './errors.js';

type ChromiumLauncher = Pick<BrowserType<ChromiumBrowser>, 'launch'>;

class OwnedPlaywrightBrowserSession implements BrowserSession {
  private closePromise: Promise<SafeExecutionError | null> | null = null;

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    readonly page: Page,
  ) {}

  close(): Promise<SafeExecutionError | null> {
    this.closePromise ??= this.closeResources();
    return this.closePromise;
  }

  private async closeResources(): Promise<SafeExecutionError | null> {
    let failed = false;
    try {
      await this.context.close();
    } catch {
      failed = true;
    }
    try {
      await this.browser.close();
    } catch {
      failed = true;
    }
    return failed ? safeError('RESOURCE_CLEANUP_FAILED') : null;
  }
}

export class PlaywrightBrowserSessionFactory implements BrowserSessionFactory {
  constructor(private readonly launcher: ChromiumLauncher = chromium) {}

  async create(options: BrowserExecutionOptions): Promise<BrowserSession> {
    let browser: Browser;
    try {
      browser = await this.launcher.launch({
        headless: options.headless,
        timeout: options.navigationTimeoutMs,
      });
    } catch {
      throw new SafeExecutionException('BROWSER_LAUNCH_FAILED');
    }

    let context: BrowserContext | null = null;
    try {
      context = await browser.newContext();
      const page = await context.newPage();
      return new OwnedPlaywrightBrowserSession(browser, context, page);
    } catch {
      await context?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      throw new SafeExecutionException('BROWSER_CONTEXT_FAILED');
    }
  }
}
