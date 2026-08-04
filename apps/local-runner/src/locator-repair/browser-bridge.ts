import type { BrowserSession } from '../execution/browser-session.js';

export class LocatorRepairBrowserBridge {
  private session: BrowserSession | null = null;

  attach(session: BrowserSession): void {
    this.session = session;
  }

  detach(session: BrowserSession): void {
    if (this.session === session) this.session = null;
  }

  current(): BrowserSession | null {
    return this.session;
  }
}
