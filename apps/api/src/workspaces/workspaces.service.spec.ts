import { IdentityRepository } from '@tasktwin/database';
import { describe, expect, it, vi } from 'vitest';

import { WorkspacesService } from './workspaces.service.js';

describe('WorkspacesService', () => {
  it('lists only workspaces returned by the membership-scoped repository', async () => {
    const workspace = {
      id: 'workspace-id',
      organizationId: 'organization-id',
      name: 'Default Workspace',
      slug: 'default',
      createdAt: new Date('2026-07-29T00:00:00.000Z'),
      updatedAt: new Date('2026-07-29T00:00:00.000Z'),
    };
    const listReachableWorkspaces = vi.fn().mockResolvedValue([workspace]);
    const service = new WorkspacesService({
      listReachableWorkspaces,
    } as unknown as IdentityRepository);

    await expect(service.listForUser('user-id')).resolves.toEqual([workspace]);
    expect(listReachableWorkspaces).toHaveBeenCalledWith('user-id');
  });
});
