import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { createHash, createPublicKey, verify } from 'node:crypto';
import {
  RunnerReleaseRepository,
  RunnerReleaseRepositoryError,
} from '@tasktwin/database';
import {
  RunnerReleaseError,
  verifyReleaseManifest,
  type ReleaseVerificationCrypto,
  type TrustedReleaseKey,
} from '@tasktwin/runner-release';

import {
  ChangeRunnerReleaseStatusRequestSchema,
  ImportRunnerReleaseRequestSchema,
  RunnerReleaseListQuerySchema,
} from './runner-release.contracts.js';
import {
  decodeTimeIdCursor,
  encodeTimeIdCursor,
} from '../common/time-id-cursor.js';

export const RUNNER_RELEASE_TRUSTED_KEYS = Symbol(
  'runner-release-trusted-keys',
);

const nodeReleaseCrypto: ReleaseVerificationCrypto = {
  sha256Hex(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  },
  verifyEd25519(input) {
    try {
      return verify(
        null,
        Buffer.from(input.canonicalManifest, 'utf8'),
        createPublicKey({
          key: Buffer.from(input.publicKeySpkiDerBase64Url, 'base64url'),
          format: 'der',
          type: 'spki',
        }),
        Buffer.from(input.signatureBase64Url, 'base64url'),
      );
    } catch {
      return false;
    }
  },
};

function rethrow(error: unknown): never {
  if (error instanceof RunnerReleaseError) {
    throw new BadRequestException({ code: error.code, message: error.message });
  }
  if (!(error instanceof RunnerReleaseRepositoryError)) throw error;
  switch (error.code) {
    case 'RELEASE_NOT_FOUND':
      throw new NotFoundException({ code: error.code });
    case 'RELEASE_VERSION_CONFLICT':
    case 'RELEASE_IMPORT_CONFLICT':
    case 'RELEASE_STATUS_CONFLICT':
      throw new ConflictException({ code: error.code });
    case 'SYSTEM_ADMIN_REQUIRED':
      throw new ForbiddenException({ code: error.code });
  }
}

@Injectable()
export class RunnerReleaseService {
  constructor(
    private readonly repository: RunnerReleaseRepository,
    @Inject(RUNNER_RELEASE_TRUSTED_KEYS)
    private readonly trustedKeys: readonly TrustedReleaseKey[],
  ) {}

  async list(rawQuery: { limit?: string; cursor?: string } = {}) {
    const query = RunnerReleaseListQuerySchema.safeParse(rawQuery);
    if (!query.success)
      throw new BadRequestException({ code: 'RELEASE_LIST_INVALID' });
    let cursor: ReturnType<typeof decodeTimeIdCursor> | undefined;
    try {
      cursor =
        query.data.cursor === undefined
          ? undefined
          : decodeTimeIdCursor(query.data.cursor);
    } catch {
      throw new BadRequestException({ code: 'RELEASE_LIST_INVALID_CURSOR' });
    }
    const result = await this.repository.list({
      limit: query.data.limit,
      ...(cursor === undefined
        ? {}
        : { cursor: { builtAt: cursor.time, id: cursor.id } }),
    });
    return {
      releases: result.releases,
      nextCursor:
        result.nextCursor === null
          ? null
          : encodeTimeIdCursor({
              time: result.nextCursor.builtAt,
              id: result.nextCursor.id,
            }),
    };
  }

  async get(id: string) {
    const release = await this.repository.get(id);
    if (release === null) throw new NotFoundException();
    return release;
  }

  async import(actorUserId: string, rawInput: unknown) {
    const parsed = ImportRunnerReleaseRequestSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'RELEASE_IMPORT_INVALID' });
    }
    try {
      const verified = verifyReleaseManifest({
        manifest: parsed.data.manifest,
        signature: parsed.data.signature,
        trustedKeys: this.trustedKeys,
        crypto: nodeReleaseCrypto,
      });
      return await this.repository.importTrusted(actorUserId, {
        manifest: verified.manifest,
        manifestDigest: verified.manifestSha256,
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  changeStatus(
    actorUserId: string,
    releaseId: string,
    status: 'deprecated' | 'blocked',
    rawInput: unknown,
  ) {
    const parsed = ChangeRunnerReleaseStatusRequestSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'RELEASE_STATUS_INVALID' });
    }
    return this.repository
      .changeStatus({
        actorUserId,
        releaseId,
        nextStatus: status,
        reason: parsed.data.reasonCode,
      })
      .catch(rethrow);
  }
}
