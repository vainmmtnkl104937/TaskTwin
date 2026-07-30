import { createHmac, randomBytes, randomInt } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  USER_CODE_ALPHABET,
  USER_CODE_CHARACTER_COUNT,
  USER_CODE_PATTERN,
} from '@tasktwin/runner-protocol';

import { getRunnerSecurityConfiguration } from '../config/environment.js';

@Injectable()
export class PairingCryptoService {
  private readonly configuration = getRunnerSecurityConfiguration();

  generateUserCode(): string {
    let compact = '';
    for (let index = 0; index < USER_CODE_CHARACTER_COUNT; index += 1) {
      compact += USER_CODE_ALPHABET[randomInt(0, USER_CODE_ALPHABET.length)]!;
    }
    return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8)}`;
  }

  generateDeviceCode(): string {
    return randomBytes(32).toString('base64url');
  }

  normalizeUserCode(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const compact = value
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '');
    if (compact.length !== USER_CODE_CHARACTER_COUNT) {
      return null;
    }
    const normalized = `${compact.slice(0, 4)}-${compact.slice(
      4,
      8,
    )}-${compact.slice(8)}`;
    return USER_CODE_PATTERN.test(normalized) ? normalized : null;
  }

  hashUserCode(userCode: string): string {
    return this.digest(
      'user-code:v1',
      userCode,
      this.configuration.pairingCodePepper,
    );
  }

  hashDeviceCode(deviceCode: string): string {
    return this.digest(
      'device-code:v1',
      deviceCode,
      this.configuration.pairingCodePepper,
    );
  }

  deriveCredential(pairingSessionId: string, deviceCode: string): string {
    return createHmac('sha256', this.configuration.credentialPepper)
      .update('credential-delivery:v1')
      .update('\0')
      .update(pairingSessionId)
      .update('\0')
      .update(deviceCode)
      .digest('base64url');
  }

  hashCredential(credential: string): string {
    return this.digest(
      'credential-auth:v1',
      credential,
      this.configuration.credentialPepper,
    );
  }

  getVerificationUri(): string {
    return `${this.configuration.webOrigin}/runner-pairing`;
  }

  private digest(domain: string, value: string, pepper: string): string {
    return createHmac('sha256', pepper)
      .update(domain)
      .update('\0')
      .update(value)
      .digest('hex');
  }
}
