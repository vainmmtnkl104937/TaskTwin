// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PRIVACY_SETTINGS } from '@tasktwin/privacy-engine';

import { PrivacyPreviewController } from '../src/content/privacy-preview-controller.js';
import type { DomRedactionPlanFactory } from '../src/content/privacy-dom-adapter.js';
import type { RedactionPreviewRenderer } from '../src/content/redaction-preview.js';

const plan = {
  schemaVersion: 1 as const,
  viewport: { width: 800, height: 600, devicePixelRatio: 1 },
  generatedAt: '2026-07-29T10:00:00.000Z',
  regions: [],
};

beforeEach(() => {
  document.body.innerHTML = '<section data-tasktwin-privacy-fixture></section>';
  window.history.replaceState({}, '', '/fixture');
});

describe('PrivacyPreviewController', () => {
  function createController() {
    const factory = {
      create: vi.fn().mockReturnValue(plan),
    } as unknown as DomRedactionPlanFactory;
    const renderer = {
      show: vi.fn(),
      clear: vi.fn(),
    } as unknown as RedactionPreviewRenderer;
    return {
      factory,
      renderer,
      controller: new PrivacyPreviewController(
        document,
        factory,
        renderer,
        () => plan.generatedAt,
      ),
    };
  }

  it('renders only an explicitly enabled local fixture preview', () => {
    const { controller, factory, renderer } = createController();
    controller.activate({
      ...DEFAULT_PRIVACY_SETTINGS,
      showRedactionPreview: true,
    });

    expect(factory.create).toHaveBeenCalledOnce();
    expect(renderer.show).toHaveBeenCalledWith(plan);
  });

  it('removes preview nodes when disabled', () => {
    const { controller, factory, renderer } = createController();
    controller.activate(DEFAULT_PRIVACY_SETTINGS);

    expect(renderer.clear).toHaveBeenCalledOnce();
    expect(factory.create).not.toHaveBeenCalled();
  });

  it('does not create a plan outside the marked loopback fixture', () => {
    const { controller, factory } = createController();
    document.querySelector('[data-tasktwin-privacy-fixture]')?.remove();
    controller.activate({
      ...DEFAULT_PRIVACY_SETTINGS,
      showRedactionPreview: true,
    });

    expect(factory.create).not.toHaveBeenCalled();
  });
});
