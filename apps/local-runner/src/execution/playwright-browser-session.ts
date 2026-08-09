import type {
  Browser,
  BrowserContext,
  BrowserType,
  ChromiumBrowser,
  Page,
} from 'playwright';
import type { SafeExecutionError } from '@tasktwin/workflow-engine';

import type {
  BrowserSession,
  BrowserSessionFactory,
} from './browser-session.js';
import type { BrowserExecutionOptions } from './contracts.js';
import { SafeExecutionException, safeError } from './errors.js';
import { PageContextTracker } from '../locator-repair/page-context.js';

type ChromiumLauncher = Pick<BrowserType<ChromiumBrowser>, 'launch'>;

class OwnedPlaywrightBrowserSession implements BrowserSession {
  private closePromise: Promise<SafeExecutionError | null> | null = null;
  private readonly pageContext: PageContextTracker;

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    readonly page: Page,
  ) {
    this.pageContext = new PageContextTracker(page);
  }

  currentPageContextDigest(): string {
    return this.pageContext.digest();
  }

  close(): Promise<SafeExecutionError | null> {
    this.closePromise ??= this.closeResources();
    return this.closePromise;
  }

  private async closeResources(): Promise<SafeExecutionError | null> {
    this.pageContext.dispose();
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
  constructor(private readonly launcher?: ChromiumLauncher) {}

  async create(options: BrowserExecutionOptions): Promise<BrowserSession> {
    let browser: Browser;
    try {
      const launcher = this.launcher ?? (await import('playwright')).chromium;
      browser = await launcher.launch({
        headless: options.headless,
        handleSIGHUP: false,
        handleSIGINT: false,
        handleSIGTERM: false,
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
