import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  appendAuditEvent,
  AuditTrailError,
  GENESIS_PREVIOUS_HASH,
  type AuditAppenderDriver,
  type AuditChainHead,
  type AuditHasher,
  type PendingAuditEvent,
  type StoredAuditEvent,
} from '../src/index.js';
import { auditInput, WORKSPACE_ID } from './fixtures.js';

const hasher: AuditHasher = {
  sha256Hex: (input) => createHash('sha256').update(input, 'utf8').digest('hex'),
};

class MemoryDriver implements AuditAppenderDriver {
  readonly events: StoredAuditEvent[] = [];
  readonly heads = new Map<string, AuditChainHead>();

  lockChainHead(workspaceId: string): Promise<AuditChainHead> {
    return Promise.resolve(
      this.heads.get(workspaceId) ?? {
        workspaceId,
        lastSequence: 0,
        lastEventHash: GENESIS_PREVIOUS_HASH,
      },
    );
  }

  findEventBySourceId(
    workspaceId: string,
    sourceId: string,
  ): Promise<StoredAuditEvent | null> {
    return Promise.resolve(
      this.events.find(
        (event) =>
          event.workspaceId === workspaceId && event.sourceId === sourceId,
      ) ?? null,
    );
  }

  insertEvent(event: PendingAuditEvent): Promise<StoredAuditEvent> {
    const stored = {
      ...event,
      id: randomUUID(),
      createdAt: event.occurredAt,
    };
    this.events.push(stored);
    return Promise.resolve(stored);
  }

  updateChainHead(head: AuditChainHead): Promise<void> {
    this.heads.set(head.workspaceId, head);
    return Promise.resolve();
  }
}

describe('audit appender', () => {
  it('creates a genesis event and links the next event', async () => {
    const driver = new MemoryDriver();
    const first = await appendAuditEvent(
      driver,
      hasher,
      auditInput('workflow.created', 'source:first'),
    );
    const second = await appendAuditEvent(
      driver,
      hasher,
      auditInput('workflow_version.created', 'source:second'),
    );
    expect(first.event.sequence).toBe(1);
    expect(first.event.previousHash).toBe(GENESIS_PREVIOUS_HASH);
    expect(second.event.sequence).toBe(2);
    expect(second.event.previousHash).toBe(first.event.eventHash);
  });

  it('returns an exact source retry without changing the chain', async () => {
    const driver = new MemoryDriver();
    const input = auditInput('workflow.created', 'source:retry');
    const first = await appendAuditEvent(driver, hasher, input);
    const retried = await appendAuditEvent(driver, hasher, input);
    expect(retried).toEqual({ event: first.event, idempotent: true });
    expect(driver.events).toHaveLength(1);
    expect(driver.heads.get(WORKSPACE_ID)?.lastSequence).toBe(1);
  });

  it('rejects conflicting source reuse', async () => {
    const driver = new MemoryDriver();
    await appendAuditEvent(
      driver,
      hasher,
      auditInput('workflow.created', 'source:conflict'),
    );
    await expect(
      appendAuditEvent(
        driver,
        hasher,
        auditInput('workflow_version.created', 'source:conflict'),
      ),
    ).rejects.toMatchObject({
      code: 'AUDIT_SOURCE_CONFLICT',
    } satisfies Partial<AuditTrailError>);
  });

  it('keeps workspace chains independent', async () => {
    const driver = new MemoryDriver();
    const first = await appendAuditEvent(
      driver,
      hasher,
      auditInput('workflow.created', 'source:workspace-a'),
    );
    const other = await appendAuditEvent(driver, hasher, {
      ...auditInput('workflow.created', 'source:workspace-b'),
      workspaceId: '00000000-0000-4000-8000-000000000099',
    });
    expect(first.event.sequence).toBe(1);
    expect(other.event.sequence).toBe(1);
    expect(other.event.previousHash).toBe(GENESIS_PREVIOUS_HASH);
  });
});
