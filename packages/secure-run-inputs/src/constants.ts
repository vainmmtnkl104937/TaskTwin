export const SECURE_RUN_INPUTS_SCHEMA_VERSION = 1;
export const SECURE_INPUT_ENVELOPE_PROFILE = 'secure_input_envelope_v1';
export const CONTENT_ENCRYPTION_ALGORITHM = 'AES-256-GCM';
export const KEY_ENCRYPTION_ALGORITHM = 'RSA-OAEP-256';
export const RUNNER_RSA_MODULUS_LENGTH = 3_072;
export const AES_KEY_BYTES = 32;
export const AES_GCM_IV_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;
export const MAX_RUN_INPUT_VARIABLES = 100;
export const MAX_RUN_SECRET_REQUIREMENTS = 100;
export const MAX_PLAINTEXT_INPUT_BYTES = 64 * 1024;
export const MAX_CIPHERTEXT_BYTES =
  MAX_PLAINTEXT_INPUT_BYTES + AES_GCM_TAG_BYTES;
export const MAX_PUBLIC_KEY_BYTES = 2 * 1024;
export const MAX_WRAPPED_KEY_BYTES = 1024;
export const DEFAULT_PREPARATION_TTL_SECONDS = 10 * 60;

export const SECURE_INPUT_CAPABILITIES = [
  'secure_input_envelope_v1',
  'interactive_secret_prompt_v1',
] as const;
