import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PairingCryptoService } from './pairing-crypto.service.js';

const originalEnvironment = { ...process.env };

beforeEach(() => {
  process.env.RUNNER_PAIRING_CODE_PEPPER = 'pairing-pepper'.padEnd(32, 'x');
  process.env.RUNNER_CREDENTIAL_PEPPER = 'credential-pepper'.padEnd(32, 'y');
  process.env.TASKTWIN_WEB_BASE_URL = 'https://tasktwin.example';
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('PairingCryptoService', () => {
  it('uses bounded, unambiguous user codes and high-entropy device codes', () => {
    const service = new PairingCryptoService();
    const userCodes = Array.from({ length: 64 }, () =>
      service.generateUserCode(),
    );
    expect(
      userCodes.every((code) =>
        /^[A-HJKM-NP-Z2-9]{4}(?:-[A-HJKM-NP-Z2-9]{4}){2}$/.test(code),
      ),
    ).toBe(true);
    expect(userCodes.join('')).not.toMatch(/[ILO01]/);
    expect(service.generateDeviceCode()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('normalizes user codes and creates stable keyed digests', () => {
    const service = new PairingCryptoService();
    expect(service.normalizeUserCode(' abcd efgh jkmp ')).toBe(
      'ABCD-EFGH-JKMP',
    );
    expect(service.hashUserCode('ABCD-EFGH-JKMP')).toHaveLength(64);
    expect(service.hashDeviceCode('A'.repeat(43))).toHaveLength(64);
  });

  it('delivers the same credential for an exact pairing retry', () => {
    const service = new PairingCryptoService();
    const first = service.deriveCredential(
      '44ceaf2f-6f9b-46fd-b2ab-468737ead64f',
      'A'.repeat(43),
    );
    const retry = service.deriveCredential(
      '44ceaf2f-6f9b-46fd-b2ab-468737ead64f',
      'A'.repeat(43),
    );
    expect(first).toBe(retry);
    expect(first).toHaveLength(43);
    expect(service.hashCredential(first)).toHaveLength(64);
  });
});
