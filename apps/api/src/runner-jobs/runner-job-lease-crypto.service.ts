import { createHmac } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { getRunnerJobSecurityConfiguration } from '../config/environment.js';

@Injectable()
export class RunnerJobLeaseCryptoService {
  private get pepper(): string {
    return getRunnerJobSecurityConfiguration().leasePepper;
  }

  deriveToken(runnerDeviceId: string, claimAttemptId: string): string {
    return createHmac('sha256', this.pepper)
      .update('workflow-run-lease:v1')
      .update('\0')
      .update(runnerDeviceId)
      .update('\0')
      .update(claimAttemptId)
      .digest('base64url');
  }

  hashToken(token: string): string {
    return createHmac('sha256', this.pepper)
      .update('workflow-run-lease-auth:v1')
      .update('\0')
      .update(token)
      .digest('hex');
  }
}
