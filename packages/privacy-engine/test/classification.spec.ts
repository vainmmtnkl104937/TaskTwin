import { describe, expect, it } from 'vitest';

import {
  classifyPrivacy,
  type PrivacyClassificationInput,
} from '../src/index.js';

function input(
  overrides: Partial<PrivacyClassificationInput> = {},
): PrivacyClassificationInput {
  return {
    schemaVersion: 1,
    tagName: 'input',
    inputType: 'text',
    autocomplete: null,
    name: null,
    id: null,
    labelText: null,
    accessibleName: null,
    placeholder: null,
    role: null,
    ...overrides,
  };
}

describe('deterministic privacy classification', () => {
  it.each([
    {
      label: 'public button',
      value: input({ tagName: 'button', inputType: null }),
      sensitivity: 'public',
      policy: 'allow',
    },
    {
      label: 'general text input',
      value: input({ labelText: 'Project note' }),
      sensitivity: 'general',
      policy: 'allow',
    },
    {
      label: 'email',
      value: input({ inputType: 'email' }),
      sensitivity: 'personal',
      policy: 'mask',
    },
    {
      label: 'phone',
      value: input({ autocomplete: 'tel' }),
      sensitivity: 'personal',
      policy: 'mask',
    },
    {
      label: 'address',
      value: input({ labelText: 'Street address' }),
      sensitivity: 'personal',
      policy: 'mask',
    },
    {
      label: 'full name',
      value: input({ name: 'fullName' }),
      sensitivity: 'personal',
      policy: 'mask',
    },
    {
      label: 'date of birth',
      value: input({ placeholder: 'Date of birth' }),
      sensitivity: 'personal',
      policy: 'mask',
    },
    {
      label: 'password type',
      value: input({ inputType: 'password' }),
      sensitivity: 'authentication',
      policy: 'block',
    },
    {
      label: 'current password',
      value: input({ autocomplete: 'current-password' }),
      sensitivity: 'authentication',
      policy: 'block',
    },
    {
      label: 'one-time code',
      value: input({ autocomplete: 'one-time-code' }),
      sensitivity: 'authentication',
      policy: 'block',
    },
    {
      label: 'card number',
      value: input({ autocomplete: 'cc-number' }),
      sensitivity: 'financial',
      policy: 'block',
    },
    {
      label: 'CVV',
      value: input({ name: 'cardCvv' }),
      sensitivity: 'financial',
      policy: 'block',
    },
    {
      label: 'bank account',
      value: input({ labelText: 'Bank account number' }),
      sensitivity: 'financial',
      policy: 'block',
    },
    {
      label: 'passport',
      value: input({ labelText: 'Passport number' }),
      sensitivity: 'identity',
      policy: 'block',
    },
    {
      label: 'citizen ID',
      value: input({ name: 'citizenId' }),
      sensitivity: 'identity',
      policy: 'block',
    },
    {
      label: 'health',
      value: input({ name: 'medicalCondition' }),
      sensitivity: 'health',
      policy: 'block',
    },
    {
      label: 'unknown sensitive',
      value: input({ labelText: 'Private key' }),
      sensitivity: 'unknown-sensitive',
      policy: 'mask',
    },
    {
      label: 'token metadata',
      value: input({ name: 'apiToken' }),
      sensitivity: 'unknown-sensitive',
      policy: 'mask',
    },
    {
      label: 'sensitive literal in allowlisted metadata',
      value: input({ accessibleName: 'Contact fixture.person@example.test' }),
      sensitivity: 'unknown-sensitive',
      policy: 'mask',
    },
  ] as const)('classifies $label', ({ value, sensitivity, policy }) => {
    expect(classifyPrivacy(value)).toMatchObject({ sensitivity, policy });
  });

  it.each([
    ['Mật khẩu', 'authentication'],
    ['Số điện thoại', 'personal'],
    ['Tài khoản ngân hàng', 'financial'],
    ['Căn cước công dân', 'identity'],
    ['Chẩn đoán sức khỏe', 'health'],
  ] as const)('supports the Vietnamese label %s', (label, sensitivity) => {
    expect(classifyPrivacy(input({ labelText: label })).sensitivity).toBe(
      sensitivity,
    );
  });

  it('returns identical decisions for identical inputs', () => {
    const value = input({ autocomplete: 'current-password' });
    expect(classifyPrivacy(value)).toEqual(classifyPrivacy(value));
  });

  it('rejects unexpected input properties', () => {
    expect(() =>
      classifyPrivacy({
        ...input(),
        pageBody: 'must-not-be-accepted',
      } as PrivacyClassificationInput),
    ).toThrow();
  });
});
