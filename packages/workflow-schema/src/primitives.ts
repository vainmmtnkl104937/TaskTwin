import { z } from 'zod';

export const MAX_WAIT_DURATION_MS = 300_000;
export const MIN_APPROVAL_TIMEOUT_MS = 5_000;
export const MAX_APPROVAL_TIMEOUT_MS = 300_000;
export const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000;
export const MAX_APPROVAL_MESSAGE_LENGTH = 1_000;
export const MIN_VERIFICATION_TIMEOUT_MS = 100;
export const MAX_VERIFICATION_TIMEOUT_MS = 60_000;

export const NonEmptyStringSchema = z.string().trim().min(1);

export const IdentifierSchema = z
  .string()
  .trim()
  .max(128)
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    'Must start with a letter or underscore and contain only letters, numbers, and underscores.',
  );

export const SecretReferenceNameSchema = IdentifierSchema;
