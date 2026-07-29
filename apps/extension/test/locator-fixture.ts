import type { LocatorBundle } from '@tasktwin/locator-engine';

export const locatorBundleFixture: LocatorBundle = {
  schemaVersion: 1,
  primary: {
    locator: {
      kind: 'testId',
      attribute: 'data-testid',
      value: 'save-button',
    },
    score: 100,
    matchCount: 1,
    unique: true,
    source: 'testId',
    reasons: [
      {
        code: 'STRONG_TEST_ID',
        message: 'Uses an allowlisted test identifier.',
      },
      {
        code: 'UNIQUE_MATCH',
        message: 'Matches exactly one element.',
      },
      {
        code: 'SHORT_VALUE',
        message: 'Uses a short normalized locator value.',
      },
    ],
  },
  fallbacks: [],
  confidence: 'high',
  generatedAt: '2026-07-29T10:00:00.000Z',
};
