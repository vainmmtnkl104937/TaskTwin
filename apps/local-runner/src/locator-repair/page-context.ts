import { createHash, randomBytes } from 'node:crypto';

import type { Frame, Page } from 'playwright';

export class PageContextTracker {
  private readonly nonce = randomBytes(32);
  private navigationEpoch = 0;
  private readonly onNavigation: (frame: Frame) => void;

  constructor(private readonly page: Page) {
    this.onNavigation = (frame) => {
      if (frame === this.page.mainFrame()) this.navigationEpoch += 1;
    };
    page.on('framenavigated', this.onNavigation);
  }

  digest(): string {
    return createHash('sha256')
      .update(this.nonce)
      .update(':')
      .update(String(this.navigationEpoch))
      .digest('hex');
  }

  dispose(): void {
    this.page.off('framenavigated', this.onNavigation);
    this.nonce.fill(0);
  }
}
