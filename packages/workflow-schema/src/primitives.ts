import { z } from 'zod';

export const MAX_WAIT_DURATION_MS = 300_000;
export const MIN_VERIFICATION_TIMEOUT_MS = 100;
export const MAX_VERIFICATION_TIMEOUT_MS = 60_000;

export const NonEmptyStringSchema = z.string().trim().min(1);

export const IdentifierSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    'Must start with a letter or underscore and contain only letters, numbers, and underscores.',
  );

export const SecretReferenceNameSchema = IdentifierSchema;
