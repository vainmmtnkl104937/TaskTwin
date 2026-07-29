import { describe, expect, it, vi } from 'vitest';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

describe('AuthController', () => {
  it('returns the explicitly mapped current user from the protected handler', async () => {
    const user = {
      id: 'user-id',
      email: 'owner@example.com',
      displayName: 'Owner',
      isActive: true,
      createdAt: new Date('2026-07-29T00:00:00.000Z'),
      updatedAt: new Date('2026-07-29T00:00:00.000Z'),
    };
    const getCurrentUser = vi.fn().mockResolvedValue(user);
    const controller = new AuthController({
      getCurrentUser,
    } as unknown as AuthService);

    await expect(
      controller.getCurrentUser({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      }),
    ).resolves.toEqual({ user });
    expect(getCurrentUser).toHaveBeenCalledWith(user.id);
  });
});
