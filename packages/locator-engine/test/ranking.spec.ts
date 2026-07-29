import { describe, expect, it } from 'vitest';

import {
  LocatorBundleSchema,
  rankLocatorBundle,
  type LocatorObservation,
} from '../src/index.js';

const generatedAt = '2026-07-29T10:00:00.000Z';

function observation(
  value: string,
  source: LocatorObservation['source'],
  locator: LocatorObservation['locator'],
  matchCount = 1,
): LocatorObservation {
  return {
    locator,
    source,
    matchCount,
    stabilityValue: value,
  };
}

function expectBundle(observations: LocatorObservation[]) {
  const result = rankLocatorBundle(observations, generatedAt);
  if (!result.success) {
    throw new Error('Expected a ranked locator bundle');
  }
  return result.bundle;
}

describe('deterministic locator ranking', () => {
  it('ranks allowlisted test IDs above all other strategies', () => {
    const bundle = expectBundle([
      observation('Save', 'text', {
        kind: 'text',
        value: 'Save',
        exact: true,
      }),
      observation('Save', 'role', {
        kind: 'role',
        role: 'button',
        name: 'Save',
        exact: true,
      }),
      observation('save-action', 'testId', {
        kind: 'testId',
        attribute: 'data-testid',
        value: 'save-action',
      }),
    ]);

    expect(bundle.primary.source).toBe('testId');
    expect(bundle.primary.score).toBe(100);
    expect(bundle.confidence).toBe('high');
  });

  it('ranks role plus name above visible text', () => {
    const bundle = expectBundle([
      observation('Open menu', 'text', {
        kind: 'text',
        value: 'Open menu',
        exact: true,
      }),
      observation('Open menu', 'role', {
        kind: 'role',
        role: 'button',
        name: 'Open menu',
        exact: true,
      }),
    ]);

    expect(bundle.primary.source).toBe('role');
  });

  it.each([
    {
      source: 'label' as const,
      locator: { kind: 'label' as const, value: 'Email', exact: true },
      expectedScore: 90,
    },
    {
      source: 'placeholder' as const,
      locator: {
        kind: 'placeholder' as const,
        value: 'Search tasks',
        exact: true,
      },
      expectedScore: 72,
    },
    {
      source: 'stableId' as const,
      locator: { kind: 'css' as const, selector: '#account-settings' },
      expectedScore: 82,
    },
  ])('applies the documented $source score', (example) => {
    const bundle = expectBundle([
      observation(
        example.source === 'label'
          ? 'Email'
          : example.source === 'placeholder'
            ? 'Search tasks'
            : 'account-settings',
        example.source,
        example.locator,
      ),
    ]);

    expect(bundle.primary.score).toBe(example.expectedScore);
  });

  it.each([
    '57a1a7d4-5ada-4bc8-ac17-10c84746a567',
    '1717171717000',
    'a5ebf13e49e5476f98a59c376cf013d4',
  ])('penalizes dynamic identifier %s', (identifier) => {
    const bundle = expectBundle([
      observation(identifier, 'stableId', {
        kind: 'css',
        selector: `[id="${identifier}"]`,
      }),
      observation('Safe action', 'role', {
        kind: 'role',
        role: 'button',
        name: 'Safe action',
        exact: true,
      }),
    ]);

    expect(bundle.primary.source).toBe('role');
    expect(bundle.fallbacks[0]?.score).toBeLessThan(bundle.primary.score);
  });

  it('strongly penalizes positional CSS', () => {
    const bundle = expectBundle([
      observation('main > div:nth-of-type(2) > button', 'css', {
        kind: 'css',
        selector: 'main > div:nth-of-type(2) > button',
      }),
    ]);

    expect(bundle.primary.score).toBeLessThan(30);
    expect(bundle.primary.reasons.map((reason) => reason.code)).toContain(
      'POSITIONAL_CSS',
    );
    expect(bundle.confidence).toBe('low');
  });

  it('deduplicates equivalent locators and keeps the strongest source', () => {
    const locator = { kind: 'css' as const, selector: '#save' };
    const bundle = expectBundle([
      observation('save', 'css', locator),
      observation('save', 'stableId', locator),
    ]);

    expect([bundle.primary, ...bundle.fallbacks]).toHaveLength(1);
    expect(bundle.primary.source).toBe('stableId');
  });

  it('uses deterministic source and canonical tie-breaking', () => {
    const observations = [
      observation('Zulu', 'text', {
        kind: 'text',
        value: 'Zulu',
        exact: true,
      }),
      observation('Alpha', 'text', {
        kind: 'text',
        value: 'Alpha',
        exact: true,
      }),
    ];

    const first = expectBundle(observations);
    const second = expectBundle([...observations].reverse());

    expect(first).toEqual(second);
    expect(first.primary.locator).toEqual({
      kind: 'text',
      value: 'Zulu',
      exact: true,
    });
  });

  it('excludes zero, duplicate and likely sensitive text matches', () => {
    const result = rankLocatorBundle(
      [
        observation(
          'Duplicate',
          'text',
          { kind: 'text', value: 'Duplicate', exact: true },
          2,
        ),
        observation('123456', 'text', {
          kind: 'text',
          value: '123456',
          exact: true,
        }),
      ],
      generatedAt,
    );

    expect(result).toEqual({
      success: false,
      reason: 'no-unique-locator',
    });
  });

  it('calculates high, medium and low confidence through fixed rules', () => {
    const high = expectBundle([
      observation('save-action', 'testId', {
        kind: 'testId',
        value: 'save-action',
      }),
      observation('Save', 'role', {
        kind: 'role',
        role: 'button',
        name: 'Save',
        exact: true,
      }),
    ]);
    const medium = expectBundle([
      observation('Email address', 'label', {
        kind: 'label',
        value: 'Email address',
        exact: true,
      }),
    ]);
    const low = expectBundle([
      observation('main > div:nth-child(2)', 'css', {
        kind: 'css',
        selector: 'main > div:nth-child(2)',
      }),
    ]);

    expect([high.confidence, medium.confidence, low.confidence]).toEqual([
      'high',
      'medium',
      'low',
    ]);
  });

  it('rejects malformed bundles and unexpected properties', () => {
    const bundle = expectBundle([
      observation('save-action', 'testId', {
        kind: 'testId',
        value: 'save-action',
      }),
    ]);

    expect(
      LocatorBundleSchema.safeParse({
        ...bundle,
        rawDom: '<button>Save</button>',
      }).success,
    ).toBe(false);
    expect(
      LocatorBundleSchema.safeParse({
        ...bundle,
        primary: {
          ...bundle.primary,
          matchCount: 2,
          unique: false,
        },
      }).success,
    ).toBe(false);
    expect(
      LocatorBundleSchema.safeParse({
        ...bundle,
        primary: {
          ...bundle.primary,
          source: 'testId',
          locator: { kind: 'css', selector: '#save-action' },
        },
      }).success,
    ).toBe(false);
  });
});
