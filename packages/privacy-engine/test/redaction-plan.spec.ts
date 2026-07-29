import { describe, expect, it } from 'vitest';

import {
  buildRedactionPlan,
  MAX_REDACTION_REGIONS,
  RedactionPlanSchema,
  type RedactionRegionCandidate,
} from '../src/index.js';

const generatedAt = '2026-07-29T10:00:00.000Z';
const viewport = { width: 800, height: 600, devicePixelRatio: 2 };

function candidate(
  overrides: Partial<RedactionRegionCandidate> = {},
): RedactionRegionCandidate {
  return {
    id: 'email-field',
    x: 10,
    y: 20,
    width: 200,
    height: 40,
    sensitivity: 'personal',
    reasons: ['PERSONAL_INPUT_TYPE'],
    ...overrides,
  };
}

describe('redaction plans', () => {
  it('normalizes negative sizes and clamps coordinates to the viewport', () => {
    const plan = buildRedactionPlan({
      viewport,
      generatedAt,
      candidates: [
        candidate({ x: 20, y: -10, width: -30, height: 40 }),
        candidate({
          id: 'right-edge',
          x: 790,
          y: 100,
          width: 30,
          height: 20,
        }),
      ],
    });

    expect(plan.regions).toEqual([
      {
        id: 'privacy-region-1',
        x: 0,
        y: 0,
        width: 20,
        height: 30,
        mode: 'solid',
        sensitivity: 'personal',
        reasons: ['PERSONAL_INPUT_TYPE'],
      },
      {
        id: 'privacy-region-2',
        x: 790,
        y: 100,
        width: 10,
        height: 20,
        mode: 'solid',
        sensitivity: 'personal',
        reasons: ['PERSONAL_INPUT_TYPE'],
      },
    ]);
    expect(RedactionPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('rejects zero-area and entirely outside regions', () => {
    expect(() =>
      buildRedactionPlan({
        viewport,
        generatedAt,
        candidates: [candidate({ width: 0 })],
      }),
    ).toThrow('non-zero area');
    expect(() =>
      buildRedactionPlan({
        viewport,
        generatedAt,
        candidates: [candidate({ x: 900 })],
      }),
    ).toThrow('non-zero area');
  });

  it('merges significant overlaps with deterministic ordering and reasons', () => {
    const candidates = [
      candidate({ id: 'second', x: 20, y: 20 }),
      candidate({
        id: 'first',
        x: 10,
        y: 20,
        sensitivity: 'financial',
        reasons: ['FINANCIAL_METADATA'],
      }),
      candidate({ id: 'last', x: 500, y: 300 }),
    ];
    const first = buildRedactionPlan({
      viewport,
      generatedAt,
      candidates,
    });
    const second = buildRedactionPlan({
      viewport,
      generatedAt,
      candidates: [...candidates].reverse(),
    });

    expect(first).toEqual(second);
    expect(first.regions).toHaveLength(2);
    expect(first.regions[0]).toMatchObject({
      x: 10,
      width: 210,
      sensitivity: 'financial',
      reasons: ['FINANCIAL_METADATA', 'PERSONAL_INPUT_TYPE'],
    });
  });

  it('enforces the maximum region count without truncation', () => {
    expect(() =>
      buildRedactionPlan({
        viewport,
        generatedAt,
        candidates: Array.from(
          { length: MAX_REDACTION_REGIONS + 1 },
          (_, index) =>
            candidate({
              id: `region-${String(index)}`,
              x: index,
            }),
        ),
      }),
    ).toThrow(`exceeds ${String(MAX_REDACTION_REGIONS)}`);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 9])(
    'rejects invalid device pixel ratio %s',
    (devicePixelRatio) => {
      expect(() =>
        buildRedactionPlan({
          viewport: { ...viewport, devicePixelRatio },
          generatedAt,
          candidates: [],
        }),
      ).toThrow();
    },
  );
});
