// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { DomLocatorBundleFactory } from '../src/content/locator-dom-adapter.js';

const timestamp = '2026-07-29T10:00:00.000Z';

function bundleFor(selector: string) {
  const element = document.querySelector(selector);
  if (element === null) throw new Error(`Missing fixture element: ${selector}`);
  const bundle = new DomLocatorBundleFactory(document).create(
    element,
    timestamp,
  );
  if (bundle === null) throw new Error('Expected a unique locator bundle');
  return bundle;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('DOM locator adapter', () => {
  it('selects an allowlisted unique test ID with high confidence', () => {
    document.body.innerHTML = '<button data-testid="save-action">Save</button>';
    const bundle = bundleFor('button');

    expect(bundle).toMatchObject({
      confidence: 'high',
      primary: {
        source: 'testId',
        score: 100,
        matchCount: 1,
        locator: {
          kind: 'testId',
          attribute: 'data-testid',
          value: 'save-action',
        },
      },
    });
  });

  it('uses role plus accessible name for an aria-label icon button', () => {
    document.body.innerHTML =
      '<button aria-label="Open settings"><span aria-hidden="true">⚙</span></button>';
    expect(bundleFor('button').primary).toMatchObject({
      source: 'role',
      locator: {
        kind: 'role',
        role: 'button',
        name: 'Open settings',
        exact: true,
      },
    });
  });

  it('prefers an associated label for a labeled input', () => {
    document.body.innerHTML =
      '<label for="email">Email address</label><input id="email" type="email">';
    expect(bundleFor('input').primary).toMatchObject({
      source: 'label',
      locator: { kind: 'label', value: 'Email address', exact: true },
    });
  });

  it('uses a unique placeholder with medium confidence', () => {
    document.body.innerHTML =
      '<input type="text" placeholder="Search projects">';
    expect(bundleFor('input')).toMatchObject({
      confidence: 'medium',
      primary: {
        source: 'placeholder',
        locator: {
          kind: 'placeholder',
          value: 'Search projects',
          exact: true,
        },
      },
    });
  });

  it('uses a stable unique ID when stronger semantic data is unavailable', () => {
    document.body.innerHTML =
      '<main><button id="stable-id-action"></button></main>';
    expect(bundleFor('button').primary).toMatchObject({
      source: 'stableId',
      locator: { kind: 'css', selector: '[id="stable-id-action"]' },
    });
  });

  it('does not retain duplicate visible text as a unique locator', () => {
    document.body.innerHTML =
      '<section><button>Continue</button></section><aside><button>Continue</button></aside>';
    const bundle = bundleFor('section button');

    expect(
      [bundle.primary, ...bundle.fallbacks].some(
        (candidate) => candidate.locator.kind === 'text',
      ),
    ).toBe(false);
  });

  it('penalizes a generated identifier below the bounded CSS fallback', () => {
    document.body.innerHTML =
      '<main><input id="react-550e8400-e29b-41d4-a716-446655440000" type="text"></main>';
    const bundle = bundleFor('input');

    expect(bundle.primary.source).toBe('css');
    const generatedId = bundle.fallbacks.find(
      (candidate) => candidate.source === 'stableId',
    );
    expect(generatedId?.reasons.map((reason) => reason.code)).toContain(
      'DYNAMIC_UUID',
    );
    expect(generatedId?.score).toBeLessThan(bundle.primary.score);
  });

  it('returns low confidence for a CSS-only element', () => {
    document.body.innerHTML = '<main><button></button></main>';
    const bundle = bundleFor('button');

    expect(bundle).toMatchObject({
      confidence: 'low',
      primary: {
        source: 'css',
        matchCount: 1,
        locator: { kind: 'css' },
      },
    });
    if (bundle.primary.locator.kind !== 'css') {
      throw new Error('Expected CSS locator');
    }
    expect(bundle.primary.locator.selector.length).toBeLessThanOrEqual(256);
  });

  it('never derives locators from password or OTP values', () => {
    document.body.innerHTML = `
      <label>Password <input type="password" value="password-plaintext"></label>
      <input type="text" autocomplete="one-time-code" value="123456" placeholder="Verification code">
    `;
    const password = bundleFor('input[type="password"]');
    const otp = bundleFor('input[autocomplete="one-time-code"]');
    const serialized = JSON.stringify([password, otp]);

    expect(serialized).not.toContain('password-plaintext');
    expect(serialized).not.toContain('123456');
  });
});
