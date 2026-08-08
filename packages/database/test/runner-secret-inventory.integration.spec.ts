import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalSecretInventoryDigest } from '@tasktwin/local-secret-store';

import {
  RunnerSecretInventoryRepository,
  createDatabaseClient,
  getRequiredDatabaseUrl,
  type PrismaClient,
} from '../src/index.js';

describe('Runner secret inventory persistence', () => {
  const userId = randomUUID();
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  const pairingSessionId = randomUUID();
  const runnerDeviceId = randomUUID();
  const vaultId = randomUUID();
  let prisma: PrismaClient;
  let repository: RunnerSecretInventoryRepository;

  beforeAll(async () => {
    prisma = createDatabaseClient(getRequiredDatabaseUrl());
    await prisma.$connect();
    await prisma.user.create({ data: { id: userId,
      email: `secret-inventory-${userId}@example.test`, passwordHash: 'test-only',
      displayName: 'Inventory tester' } });
    await prisma.organization.create({ data: { id: organizationId,
      name: 'Secret inventory test', slug: `secret-inventory-${organizationId}` } });
    await prisma.organizationMember.create({ data: { userId, organizationId, role: 'OWNER' } });
    await prisma.workspace.create({ data: { id: workspaceId, organizationId,
      name: 'Secret inventory Workspace', slug: `inventory-${workspaceId}` } });
    await prisma.runnerPairingSession.create({ data: {
      id: pairingSessionId,
      deviceCodeHash: createHash('sha256').update(randomUUID()).digest('hex'),
      userCodeDigest: createHash('sha256').update(randomUUID()).digest('hex'),
      status: 'CONSUMED', displayName: 'Inventory Runner', platform: 'linux',
      architecture: 'x64', runnerVersion: '0.1.0', installationId: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000), pollIntervalSeconds: 5,
      workspaceId,
    } });
    await prisma.runnerDevice.create({ data: { id: runnerDeviceId, workspaceId,
      pairingSessionId, installationId: randomUUID(), displayName: 'Inventory Runner',
      platform: 'linux', architecture: 'x64', runnerVersion: '0.1.0' } });
    repository = new RunnerSecretInventoryRepository(prisma);
  });

  afterAll(async () => {
    await prisma.workspaceAuditEvent.deleteMany({ where: { workspaceId } });
    await prisma.workspaceAuditChainHead.deleteMany({ where: { workspaceId } });
    await prisma.runnerSecretInventory.deleteMany({ where: { workspaceId } });
    await prisma.runnerDevice.deleteMany({ where: { id: runnerDeviceId } });
    await prisma.runnerPairingSession.deleteMany({ where: { id: pairingSessionId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  function request(
    revision: number,
    entries: Array<{ alias: string; secretVersionId: string }>,
    targetVaultId = vaultId,
  ) {
    const inventoryDigest = createLocalSecretInventoryDigest(
      { sha256Hex: (value) => createHash('sha256').update(value).digest('hex') },
      { vaultId: targetVaultId, workspaceId, runnerDeviceId, vaultRevision: revision, entries },
    );
    return { schemaVersion: 1 as const, profile: 'local_secret_inventory_v1' as const,
      vaultId: targetVaultId, vaultRevision: revision, inventoryDigest, storeStatus: 'ready' as const,
      entries };
  }

  it('is idempotent and rejects revision conflict, rollback, and vault replacement', async () => {
    const first = request(1, [{ alias: 'LOGIN_PASSWORD', secretVersionId: randomUUID() }]);
    await expect(repository.synchronize({ runnerDeviceId, workspaceId, request: first }))
      .resolves.toMatchObject({ idempotent: false });
    await expect(repository.synchronize({ runnerDeviceId, workspaceId, request: first }))
      .resolves.toMatchObject({ idempotent: true });

    const conflicting = request(1, [{ alias: 'LOGIN_PASSWORD', secretVersionId: randomUUID() }]);
    await expect(repository.synchronize({ runnerDeviceId, workspaceId,
      request: conflicting })).rejects.toMatchObject({ code: 'INVENTORY_REVISION_CONFLICT' });
    const second = request(2, [{ alias: 'LOGIN_PASSWORD', secretVersionId: randomUUID() }]);
    await expect(repository.synchronize({ runnerDeviceId, workspaceId, request: second }))
      .resolves.toMatchObject({ idempotent: false });
    await expect(repository.synchronize({ runnerDeviceId, workspaceId, request: first }))
      .rejects.toMatchObject({ code: 'INVENTORY_ROLLBACK_DETECTED' });
    const replacement = request(3, second.entries, randomUUID());
    await expect(repository.synchronize({ runnerDeviceId, workspaceId,
      request: replacement })).rejects.toMatchObject({ code: 'VAULT_IDENTITY_CONFLICT' });

    const stored = await repository.getForRunner(runnerDeviceId);
    expect(stored).toMatchObject({ vaultId, vaultRevision: 2, entries: second.entries });
    expect(JSON.stringify(stored)).not.toContain('secretValue');
    expect(await prisma.workspaceAuditEvent.count({ where: { workspaceId,
      eventType: 'runner.secret_inventory.updated' } })).toBe(2);
    const auditRows = await prisma.workspaceAuditEvent.findMany({
      where: { workspaceId, eventType: 'runner.secret_inventory.updated' },
      select: { payload: true },
    });
    expect(JSON.stringify(auditRows)).not.toContain('LOGIN_PASSWORD');
    expect(JSON.stringify(auditRows)).not.toContain('secretValue');
  });
});
