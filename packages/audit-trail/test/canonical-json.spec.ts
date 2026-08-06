import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createCanonicalJsonDigest } from '../../database/src/recording/canonical-json.js';
import {
  hashAuditContent,
  serializeCanonicalJson,
  type AuditHasher,
} from '../src/index.js';

const hasher: AuditHasher = {
  sha256Hex: (input) => createHash('sha256').update(input, 'utf8').digest('hex'),
};

describe('canonical JSON', () => {
  it('sorts object keys deterministically and preserves array order', () => {
    expect(serializeCanonicalJson({ z: 1, a: 2, nested: { y: 3, x: 4 } })).toBe(
      '{"a":2,"nested":{"x":4,"y":3},"z":1}',
    );
    expect(serializeCanonicalJson({ items: [3, 1, 2] })).toBe(
      '{"items":[3,1,2]}',
    );
  });

  it('uses code-unit sorting rather than locale-dependent sorting', () => {
    const canonical = serializeCanonicalJson({ ä: 1, z: 2, A: 3 });
    expect(canonical).toBe('{"A":3,"z":2,"ä":1}');
  });

  it('rejects invalid numbers and non-JSON values', () => {
    expect(() => serializeCanonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => serializeCanonicalJson(Number.POSITIVE_INFINITY)).toThrow(
      TypeError,
    );
    expect(() => serializeCanonicalJson({ missing: undefined })).toThrow(
      TypeError,
    );
    expect(() => serializeCanonicalJson(() => true)).toThrow(TypeError);
    expect(() => serializeCanonicalJson(new Date())).toThrow(TypeError);
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => serializeCanonicalJson(circular)).toThrow(TypeError);
  });

  it('matches the database canonical digest for equivalent objects', () => {
    const first = { b: [3, { y: false, x: null }], a: 'same' };
    const second = { a: 'same', b: [3, { x: null, y: false }] };
    const firstCanonical = serializeCanonicalJson(first);
    const secondCanonical = serializeCanonicalJson(second);
    expect(firstCanonical).toBe(secondCanonical);
    expect(hashAuditContent(hasher, firstCanonical)).toBe(
      createCanonicalJsonDigest(first),
    );
    expect(hashAuditContent(hasher, secondCanonical)).toBe(
      createCanonicalJsonDigest(second),
    );
  });
});
