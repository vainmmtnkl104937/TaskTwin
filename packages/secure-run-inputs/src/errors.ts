import type { SafeSecureRunInputErrorCode } from './contracts.js';

const MESSAGES = {
  INVALID_SECURE_INPUT: 'The secure run input is invalid.',
  UNSUPPORTED_CRYPTO_PROFILE: 'The secure input profile is unsupported.',
  INVALID_KEY_METADATA: 'The Runner encryption key is invalid.',
  KEY_NOT_FOUND: 'The Runner encryption key is unavailable.',
  KEY_CONFLICT: 'The Runner encryption key conflicts with stored state.',
  PREPARATION_NOT_FOUND: 'The run input preparation is unavailable.',
  PREPARATION_EXPIRED: 'The run input preparation has expired.',
  PREPARATION_CONFLICT:
    'The run input preparation conflicts with stored state.',
  CAPABILITY_UNAVAILABLE: 'The selected Runner lacks a required capability.',
  FILE_INPUT_UNAVAILABLE: 'File input delivery is unavailable.',
  ENVELOPE_TOO_LARGE: 'The encrypted run input is too large.',
  ENVELOPE_BINDING_INVALID: 'The encrypted run input binding is invalid.',
  ENVELOPE_DIGEST_INVALID: 'The encrypted run input digest is invalid.',
  DECRYPTION_FAILED: 'The encrypted run input could not be decrypted.',
  RUNTIME_INPUTS_INVALID: 'The workflow runtime inputs are invalid.',
  SECRET_UNAVAILABLE: 'A required local secret is unavailable.',
  SECRET_PROMPT_CANCELLED: 'Local secret entry was cancelled.',
  SECRET_PROMPT_TIMEOUT: 'Local secret entry timed out.',
  SENSITIVE_STATE_CLEANUP_FAILED:
    'Sensitive runtime state could not be cleared cleanly.',
} as const satisfies Record<SafeSecureRunInputErrorCode, string>;

export class SecureRunInputError extends Error {
  constructor(readonly code: SafeSecureRunInputErrorCode) {
    super(MESSAGES[code]);
    this.name = 'SecureRunInputError';
  }
}
