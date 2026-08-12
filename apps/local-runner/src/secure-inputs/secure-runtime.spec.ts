import { InMemorySecretProvider } from '@tasktwin/secure-run-inputs';
import { describe, expect, it } from 'vitest';

import { acquireLocalSecretRuntime } from './secure-runtime.js';

describe('local secret runtime', () => {
  it('resolves safe literals and local secrets while rejecting runtime variables', async () => {
    const runtime = await acquireLocalSecretRuntime({
      runtimeInput: {
        kind: 'local_secret_store',
        inventory: {
          schemaVersion: 1,
          vaultId: 'vault-1',
          vaultRevision: 1,
          inventoryDigest: 'a'.repeat(64),
        },
        secrets: [{ secretName: 'accountPassword', usageCount: 1 }],
      },
      secretProvider: new InMemorySecretProvider({
        accountPassword: 'local-secret-value',
      }),
      signal: new AbortController().signal,
    });

    try {
      expect(runtime.resolver.hasVariable('customerName', 'string')).toBe(
        false,
      );
      expect(runtime.resolver.hasSecret('accountPassword')).toBe(true);
      expect(
        runtime.resolver.resolve(
          { kind: 'literal', value: 'https://example.test' },
          'navigate.url',
        ),
      ).toBe('https://example.test');
      expect(
        runtime.resolver.resolve(
          { kind: 'secret', secretName: 'accountPassword' },
          'fill.value',
        ),
      ).toBe('local-secret-value');
      expect(() =>
        runtime.resolver.resolve(
          { kind: 'variable', variableName: 'customerName' },
          'fill.value',
        ),
      ).toThrow();
    } finally {
      await runtime.dispose();
    }
  });
});
