import { describe, expect, it } from 'vitest';

import {
  AUDIT_EVENT_TYPES,
  AUDIT_PAYLOAD_SCHEMAS,
  parseAuditEventInput,
} from '../src/index.js';
import { auditInput, VALID_PAYLOADS } from './fixtures.js';

export const FORBIDDEN_AUDIT_FIELDS = [
  'value',
  'text',
  'input',
  'secret',
  'token',
  'password',
  'ciphertext',
  'wrappedKey',
  'iv',
  'aad',
  'locator',
  'selector',
  'url',
  'href',
  'query',
  'fragment',
  'dom',
  'html',
  'screenshot',
  'stackTrace',
  'expectedValue',
  'observedValue',
  'expected',
  'observed',
  'rawError',
  'stack',
  'email',
  'userAgent',
  'ip',
  'username',
  'hostname',
  'serviceAccount',
  'protectedKey',
  'masterKey',
  'vaultPath',
  'localPath',
  'outputLength',
  'outputHash',
] as const;

describe('strict audit payload schemas', () => {
  it('has one strict schema for every event type', () => {
    expect(Object.keys(AUDIT_PAYLOAD_SCHEMAS).sort()).toEqual(
      [...AUDIT_EVENT_TYPES].sort(),
    );
    for (const eventType of AUDIT_EVENT_TYPES) {
      expect(AUDIT_PAYLOAD_SCHEMAS[eventType].safeParse(VALID_PAYLOADS[eventType]).success).toBe(
        true,
      );
      expect(
        AUDIT_PAYLOAD_SCHEMAS[eventType].safeParse({
          ...VALID_PAYLOADS[eventType],
          unexpectedProperty: true,
        }).success,
      ).toBe(false);
    }
  });

  it('normalizes timestamps and rejects arbitrary envelope fields', () => {
    const parsed = parseAuditEventInput({
      ...auditInput('workflow_run.started'),
      occurredAt: '2026-08-05T14:00:00+02:00',
    });
    expect(parsed.occurredAt).toBe('2026-08-05T12:00:00.000Z');
    expect(
      () =>
        parseAuditEventInput({
          ...auditInput('workflow_run.started'),
          arbitrary: true,
        }),
    ).toThrow();
  });

  it('rejects every forbidden field in every payload schema', () => {
    for (const eventType of AUDIT_EVENT_TYPES) {
      for (const field of FORBIDDEN_AUDIT_FIELDS) {
        expect(
          AUDIT_PAYLOAD_SCHEMAS[eventType].safeParse({
            ...VALID_PAYLOADS[eventType],
            [field]: 'known-sensitive-marker',
          }).success,
          `${eventType} accepted forbidden field ${field}`,
        ).toBe(false);
      }
    }
  });
});
