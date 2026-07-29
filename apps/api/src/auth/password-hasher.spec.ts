import { describe, expect, it } from 'vitest';

import { PasswordHasher } from './password-hasher.js';

describe('PasswordHasher', () => {
  it('hashes with Argon2id and verifies without retaining plaintext', async () => {
    const hasher = new PasswordHasher();
    const password = 'correct horse battery staple';
    const passwordHash = await hasher.hash(password);

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(passwordHash).not.toContain(password);
    await expect(hasher.verify(passwordHash, password)).resolves.toBe(true);
    await expect(
      hasher.verify(passwordHash, 'incorrect password'),
    ).resolves.toBe(false);
  });
});
