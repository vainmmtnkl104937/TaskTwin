import type { PrivacySettings } from '@tasktwin/privacy-engine';

import type { PrivacyPreviewLifecycle } from '../content-script-controller.js';
import { DomRedactionPlanFactory } from './privacy-dom-adapter.js';
import { RedactionPreviewRenderer } from './redaction-preview.js';

const FIXTURE_MARKER_SELECTOR = '[data-tasktwin-privacy-fixture]';

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  );
}

export class PrivacyPreviewController implements PrivacyPreviewLifecycle {
  constructor(
    private readonly document: Document,
    private readonly planFactory: DomRedactionPlanFactory,
    private readonly renderer: RedactionPreviewRenderer,
    private readonly now: () => string,
  ) {}

  activate(settings: PrivacySettings): void {
    this.renderer.clear();
    const hostname = this.document.location.hostname;
    if (
      !settings.showRedactionPreview ||
      !isLoopbackHostname(hostname) ||
      this.document.querySelector(FIXTURE_MARKER_SELECTOR) === null
    ) {
      return;
    }

    this.renderer.show(this.planFactory.create(settings, this.now()));
  }

  clear(): void {
    this.renderer.clear();
  }
}
