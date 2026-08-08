import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ORGANIZATION_ROLES_METADATA } from '../authorization/organization-roles.decorator.js';
import { OperationsController } from './operations.controller.js';
import type { OperationsQueryService } from './operations-query.service.js';

describe('OperationsController', () => {
  it('allows every existing Workspace reader role', () => {
    const roles = Reflect.getMetadata(
      ORGANIZATION_ROLES_METADATA,
      OperationsController.prototype.overview,
    ) as string[];
    expect(roles).toEqual(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);
  });

  it('rejects arbitrary windows before querying metrics', async () => {
    const service = { getSnapshot: vi.fn() };
    const controller = new OperationsController(
      service as unknown as OperationsQueryService,
    );
    await expect(
      controller.overview('00000000-0000-4000-8000-000000000028', '2h'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.getSnapshot).not.toHaveBeenCalled();
  });
});
