import { z } from 'zod';

import { LocalSecretStoreStatusSchema } from './contracts.js';

export const LocalSecretVaultSafeSummarySchema = z.strictObject({
  status: LocalSecretStoreStatusSchema,
  vaultRevision: z.number().int().positive().nullable(),
  configuredSecretCount: z.number().int().nonnegative().max(1_000),
  synchronized: z.boolean(),
});

export type LocalSecretVaultSafeSummary = z.infer<typeof LocalSecretVaultSafeSummarySchema>;
