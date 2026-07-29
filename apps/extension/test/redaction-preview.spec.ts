// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import type { RedactionPlan } from '@tasktwin/privacy-engine';

import { RedactionPreviewRenderer } from '../src/content/redaction-preview.js';

const region: RedactionPlan['regions'][number] = {
  id: 'privacy-region-1',
  x: 10,
  y: 20,
  width: 200,
  height: 40,
  mode: 'solid',
  sensitivity: 'personal',
  reasons: ['PERSONAL_INPUT_TYPE'],
};

const plan: RedactionPlan = {
  schemaVersion: 1,
  viewport: {
    width: 1280,
    height: 720,
    devicePixelRatio: 1,
  },
  generatedAt: '2026-07-29T10:00:00.000Z',
  regions: [region],
};

beforeEach(() => {
  document.documentElement.replaceChildren(
    document.createElement('head'),
    document.createElement('body'),
  );
});

describe('RedactionPreviewRenderer', () => {
  it('shows bounded non-interactive overlays without page values', () => {
    const renderer = new RedactionPreviewRenderer(document);

    renderer.show(plan);

    const root = document.querySelector(
      '[data-tasktwin-redaction-preview]',
    ) as HTMLElement | null;
    const region = document.querySelector(
      '[data-tasktwin-redaction-region]',
    ) as HTMLElement | null;

    expect(root?.getAttribute('aria-hidden')).toBe('true');
    expect(root?.style.pointerEvents).toBe('none');
    expect(region?.style.pointerEvents).toBe('none');
    expect(region?.style.left).toBe('10px');
    expect(region?.style.top).toBe('20px');
    expect(region?.style.width).toBe('200px');
    expect(region?.style.height).toBe('40px');
    expect(root?.textContent).toBe('');
  });

  it('replaces previous overlays and clears every preview node', () => {
    const renderer = new RedactionPreviewRenderer(document);

    renderer.show(plan);
    renderer.show({
      ...plan,
      regions: [{ ...region, id: 'privacy-region-2' }],
    });

    expect(
      document.querySelectorAll('[data-tasktwin-redaction-preview]'),
    ).toHaveLength(1);
    expect(
      document
        .querySelector('[data-tasktwin-redaction-region]')
        ?.getAttribute('data-tasktwin-redaction-region'),
    ).toBe('privacy-region-2');

    renderer.clear();

    expect(
      document.querySelectorAll('[data-tasktwin-redaction-preview]'),
    ).toHaveLength(0);
  });

  it('does not remove page-owned elements that reuse the preview attribute', () => {
    const pageElement = document.createElement('section');
    pageElement.setAttribute('data-tasktwin-redaction-preview', 'page-owned');
    document.body.append(pageElement);
    const renderer = new RedactionPreviewRenderer(document);

    renderer.show(plan);
    renderer.clear();

    expect(pageElement.isConnected).toBe(true);
  });

  it('does not add a preview root for an empty plan', () => {
    const renderer = new RedactionPreviewRenderer(document);

    renderer.show({ ...plan, regions: [] });

    expect(
      document.querySelector('[data-tasktwin-redaction-preview]'),
    ).toBeNull();
  });

  it('rejects an invalid plan without replacing the current preview', () => {
    const renderer = new RedactionPreviewRenderer(document);
    renderer.show(plan);

    expect(() =>
      renderer.show({
        ...plan,
        regions: [{ ...region, width: Number.POSITIVE_INFINITY }],
      }),
    ).toThrow();
    expect(
      document
        .querySelector('[data-tasktwin-redaction-region]')
        ?.getAttribute('data-tasktwin-redaction-region'),
    ).toBe('privacy-region-1');
  });
});
