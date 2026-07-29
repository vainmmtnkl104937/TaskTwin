import type { LocatorSource } from './contracts.js';

export const MAX_LOCATOR_CANDIDATES = 32;
export const MAX_LOCATOR_FALLBACKS = 4;
export const MAX_LOCATOR_VALUE_LENGTH = 160;
export const MAX_TEST_ID_LENGTH = 80;
export const MAX_VISIBLE_TEXT_LENGTH = 80;
export const MAX_CSS_SELECTOR_LENGTH = 256;

export const LOCATOR_SOURCE_PRIORITY = {
  testId: 0,
  role: 1,
  label: 2,
  stableId: 3,
  placeholder: 4,
  stableName: 5,
  text: 6,
  css: 7,
} as const satisfies Record<LocatorSource, number>;

export const LOCATOR_BASE_SCORES = {
  testId: 90,
  role: 82,
  label: 76,
  stableId: 72,
  placeholder: 62,
  stableName: 58,
  text: 48,
  css: 30,
} as const satisfies Record<LocatorSource, number>;

export const LOCATOR_SCORE_ADJUSTMENTS = {
  unique: 8,
  semantic: 4,
  shortValue: 2,
  zeroMatches: -100,
  multipleMatches: -40,
  uuid: -45,
  timestamp: -35,
  hash: -40,
  numericSuffix: -18,
  frameworkGenerated: -30,
  randomLooking: -30,
  longText: -10,
  positionalCss: -25,
  generatedClass: -20,
  cssDepthStep: -4,
  cssDepthMaximum: -16,
  dynamicMaximum: -50,
} as const;
