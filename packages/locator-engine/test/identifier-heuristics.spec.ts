import { describe, expect, it } from 'vitest';

import {
  cssUsesPosition,
  detectIdentifierRisks,
  getCssDepth,
  looksLikeGeneratedClass,
} from '../src/index.js';

describe('identifier and CSS heuristics', () => {
  it('detects UUIDs deterministically', () => {
    expect(
      detectIdentifierRisks('57a1a7d4-5ada-4bc8-ac17-10c84746a567'),
    ).toContain('uuid');
    expect(
      detectIdentifierRisks('react-57a1a7d4-5ada-4bc8-ac17-10c84746a567'),
    ).toContain('uuid');
  });

  it('detects timestamp-like identifiers', () => {
    expect(detectIdentifierRisks('1717171717000')).toContain('timestamp');
    expect(detectIdentifierRisks('panel-2026-07-29-120000')).toContain(
      'timestamp',
    );
  });

  it('detects long hashes and generated numeric suffixes', () => {
    expect(detectIdentifierRisks('a5ebf13e49e5476f98a59c376cf013d4')).toContain(
      'hash',
    );
    expect(detectIdentifierRisks('field-173892')).toContain('numericSuffix');
  });

  it('detects common framework-generated and random values', () => {
    expect(detectIdentifierRisks('mat-input-1234')).toContain(
      'frameworkGenerated',
    );
    expect(detectIdentifierRisks('aB3dE5fG7hJ9')).toContain('randomLooking');
  });

  it('detects positional, deep and generated-class CSS', () => {
    expect(cssUsesPosition('main > div:nth-of-type(2) > button')).toBe(true);
    expect(getCssDepth('main > section > form > button')).toBe(4);
    expect(looksLikeGeneratedClass('button.css-a8f92de1')).toBe(true);
  });
});
