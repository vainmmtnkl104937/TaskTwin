import { describe, expect, it } from 'vitest';

import { ControlPlaneError } from '@/lib/server/control-plane';
import {
  getWebSecurityHeaders,
  WEB_POWERED_BY_HEADER,
} from '@/lib/security-headers';

describe('Web production security', () => {
  it('publishes restrictive security headers without a framework fingerprint', () => {
    expect(WEB_POWERED_BY_HEADER).toBe(false);
    const headers = new Map(
      getWebSecurityHeaders(true).map((header) => [header.key, header.value]),
    );
    expect(headers.get('Content-Security-Policy')).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
    expect(headers.get('Strict-Transport-Security')).toContain(
      'max-age=31536000',
    );
  });

  it('keeps upstream error bodies non-enumerable', () => {
    const error = new ControlPlaneError(409, {
      code: 'SAFE_CONFLICT',
      accessToken: 'must-not-be-enumerated',
    });
    expect(error.body).toMatchObject({ code: 'SAFE_CONFLICT' });
    expect(Object.keys(error)).not.toContain('body');
    expect(JSON.stringify(error)).not.toContain('must-not-be-enumerated');
  });
});
