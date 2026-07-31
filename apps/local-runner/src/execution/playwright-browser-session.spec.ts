import type { Browser, BrowserContext, Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';

import { PlaywrightBrowserSessionFactory } from './playwright-browser-session.js';

const options = {
  headless: true,
  actionTimeoutMs: 1_000,
  navigationTimeoutMs: 2_000,
  executionTimeoutMs: 10_000,
};

function setup() {
  const page = {} as Page;
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as BrowserContext;
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Browser;
  const launcher = {
    launch: vi.fn().mockResolvedValue(browser),
  };
  const factory = new PlaywrightBrowserSessionFactory(launcher as never);
  return { page, context, browser, launcher, factory };
}

describe('Playwright browser lifecycle', () => {
  it('creates one isolated context without profile options and closes resources', async () => {
    const context = setup();
    const session = await context.factory.create(options);
    expect(session.page).toBe(context.page);
    expect(context.launcher.launch).toHaveBeenCalledWith({
      headless: true,
      handleSIGHUP: false,
      handleSIGINT: false,
      handleSIGTERM: false,
      timeout: 2_000,
    });
    expect(context.browser.newContext).toHaveBeenCalledWith();
    expect(JSON.stringify(context.launcher.launch.mock.calls)).not.toContain(
      'userDataDir',
    );
    await expect(session.close()).resolves.toBeNull();
    await expect(session.close()).resolves.toBeNull();
    expect(context.context.close).toHaveBeenCalledOnce();
    expect(context.browser.close).toHaveBeenCalledOnce();
  });

  it('closes the browser after partial context failure', async () => {
    const context = setup();
    vi.mocked(context.browser.newContext).mockRejectedValueOnce(
      new Error('context failed'),
    );
    await expect(context.factory.create(options)).rejects.toMatchObject({
      safe: { code: 'BROWSER_CONTEXT_FAILED' },
    });
    expect(context.browser.close).toHaveBeenCalledOnce();
  });

  it('closes context and browser after partial page failure', async () => {
    const context = setup();
    vi.mocked(context.context.newPage).mockRejectedValueOnce(
      new Error('page failed'),
    );
    await expect(context.factory.create(options)).rejects.toMatchObject({
      safe: { code: 'BROWSER_CONTEXT_FAILED' },
    });
    expect(context.context.close).toHaveBeenCalledOnce();
    expect(context.browser.close).toHaveBeenCalledOnce();
  });

  it('maps launch failure without attempting a personal profile', async () => {
    const context = setup();
    context.launcher.launch.mockRejectedValueOnce(new Error('launch failed'));
    await expect(context.factory.create(options)).rejects.toMatchObject({
      safe: { code: 'BROWSER_LAUNCH_FAILED' },
    });
    expect(context.browser.newContext).not.toHaveBeenCalled();
  });
});
