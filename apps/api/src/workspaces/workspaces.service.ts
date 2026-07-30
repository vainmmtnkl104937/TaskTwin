import { Injectable } from '@nestjs/common';
import { IdentityRepository } from '@tasktwin/database';

import {
  toWorkspaceResponse,
  type WorkspaceResponse,
} from '../auth/auth.types.js';

@Injectable()
export class WorkspacesService {
  constructor(private readonly identityRepository: IdentityRepository) {}

  async listForUser(userId: string): Promise<WorkspaceResponse[]> {
    const workspaces =
      await this.identityRepository.listReachableWorkspaces(userId);
    return workspaces.map((workspace) =>
      toWorkspaceResponse(workspace, workspace.role),
    );
  }
}
