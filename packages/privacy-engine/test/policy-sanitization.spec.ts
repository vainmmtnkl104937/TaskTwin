import { describe, expect, it } from 'vitest';

import {
  classifyPrivacy,
  containsSensitiveLiteral,
  DEFAULT_PRIVACY_SETTINGS,
  detectSensitiveLiteralKinds,
  PrivacyDecisionSchema,
  resolvePrivacyPolicy,
  sanitizeCapturedValue,
  sanitizePersistedText,
  type PrivacyClassificationInput,
} from '../src/index.js';

const baseInput: PrivacyClassificationInput = {
  schemaVersion: 1,
  tagName: 'input',
  inputType: 'email',
  autocomplete: 'email',
  name: 'email',
  id: 'safe-email-field',
  labelText: 'Email address',
  accessibleName: 'Email address',
  placeholder: null,
  role: null,
};

describe('privacy policy and sanitization', () => {
  it('masks personal data by default and allows it only through its setting', () => {
    expect(classifyPrivacy(baseInput).policy).toBe('mask');
    expect(
      classifyPrivacy(baseInput, {
        ...DEFAULT_PRIVACY_SETTINGS,
        personalDataPolicy: 'allow',
      }).policy,
    ).toBe('allow');
  });

  it.each(['authentication', 'financial', 'identity', 'health'] as const)(
    'never weakens the blocked %s policy',
    (sensitivity) => {
      expect(
        resolvePrivacyPolicy(sensitivity, {
          ...DEFAULT_PRIVACY_SETTINGS,
          personalDataPolicy: 'allow',
        }),
      ).toBe('block');
    },
  );

  it('rejects a runtime decision that weakens a blocked policy', () => {
    expect(
      PrivacyDecisionSchema.safeParse({
        schemaVersion: 1,
        sensitivity: 'financial',
        policy: 'allow',
        confidence: 'high',
        matchedRules: ['FINANCIAL_METADATA'],
        reasons: ['Deterministic financial metadata rules matched.'],
      }).success,
    ).toBe(false);
  });

  it('represents masked values as null', () => {
    const decision = classifyPrivacy(baseInput);
    expect(sanitizeCapturedValue('person@example.test', decision)).toEqual({
      policy: 'mask',
      value: null,
      truncated: false,
    });
  });

  it('omits blocked values and never returns their plaintext', () => {
    const decision = classifyPrivacy({
      ...baseInput,
      inputType: 'password',
      autocomplete: 'current-password',
    });
    const result = sanitizeCapturedValue('fixture-secret-value', decision);
    expect(result).toEqual({ policy: 'block' });
    expect(JSON.stringify(result)).not.toContain('fixture-secret-value');
  });

  it('never echoes a captured value in sanitization errors', () => {
    const decision = classifyPrivacy(baseInput);
    const capturedValue = ['private', 'fixture', 'value'].join('-');
    try {
      sanitizeCapturedValue(capturedValue, decision, 0);
      throw new Error('Expected sanitization to reject the invalid bound.');
    } catch (error: unknown) {
      expect(String(error)).not.toContain(capturedValue);
    }
  });

  it('bounds allowed values', () => {
    const decision = classifyPrivacy({
      ...baseInput,
      inputType: 'text',
      autocomplete: null,
      name: 'projectNote',
      id: 'project-note',
      labelText: 'Project note',
      accessibleName: 'Project note',
    });
    expect(sanitizeCapturedValue('abcdef', decision, 4)).toEqual({
      policy: 'allow',
      value: 'abcd',
      truncated: true,
    });
  });

  it('removes sensitive literals while retaining safe structural text', () => {
    expect(containsSensitiveLiteral('person@example.test')).toBe(true);
    expect(containsSensitiveLiteral('+84 912 345 678')).toBe(true);
    expect(sanitizePersistedText('person@example.test')).toBeNull();
    expect(sanitizePersistedText('privacy-safe-structural-id')).toBe(
      'privacy-safe-structural-id',
    );
    expect(sanitizePersistedText('Email address')).toBe('Email address');
  });

  it.each([
    ['person@example.test', ['personal']],
    ['+84 912 345 678', ['personal']],
  ] as const)('classifies the personal literal %s', (value, expectedKinds) => {
    expect(detectSensitiveLiteralKinds(value)).toEqual(expectedKinds);
  });

  it.each([
    ['123456', ['authentication']],
    ['token=fixture-token-value', ['authentication']],
  ] as const)(
    'classifies the authentication literal %s',
    (value, expectedKinds) => {
      expect(detectSensitiveLiteralKinds(value)).toEqual(expectedKinds);
    },
  );

  it('classifies a long number as financial or identity data', () => {
    expect(detectSensitiveLiteralKinds('4111111111111111')).toEqual([
      'financial-or-identity',
    ]);
  });

  it('returns deterministic unique kinds in fixed order', () => {
    expect(
      detectSensitiveLiteralKinds(
        'person@example.test token=fixture-token-value 4111111111111111',
      ),
    ).toEqual(['personal', 'authentication', 'financial-or-identity']);
  });

  it('does not classify a safe structural value', () => {
    expect(detectSensitiveLiteralKinds('tasktwin-save-button')).toEqual([]);
  });
});
