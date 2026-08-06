import { Injectable } from '@nestjs/common';

import { AuditTrailService } from './audit-trail.service.js';

/**
 * Integration surface that downstream domain modules (workflow lifecycle,
 * policy, run, approval, repair, locator-repair) call when they perform a
 * mutating action. Every mutating path passes through this entry point so
 * the append-only chain is the single audit trail seam.
 *
 * The implementation intentionally defers to {@link AuditTrailService} so
 * that transactional semantics are honoured by the caller's existing
 * Prisma transaction client.
 */
@Injectable()
export class AuditTrailIntegration {
  constructor(private readonly service: AuditTrailService) {}

  rethrow(error: unknown): never {
    this.service.rethrowAuditTrailError(error);
  }
}