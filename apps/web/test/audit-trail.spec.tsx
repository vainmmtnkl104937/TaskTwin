import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listAuditEvents, getAuditEvent, verifyAuditTrail } = vi.hoisted(() => ({
  listAuditEvents: vi.fn(),
  getAuditEvent: vi.fn(),
  verifyAuditTrail: vi.fn(),
}));

vi.mock('@/lib/server/control-plane', () => ({
  listAuditEvents,
  getAuditEvent,
  verifyAuditTrail,
}));

import { AuditEventDetail } from '@/components/audit-trail/audit-event-detail';
import { AuditEventRow } from '@/components/audit-trail/audit-event-row';
import { AuditVerifyButton } from '@/components/audit-trail/audit-verify-button';

const baseEvent = {
  id: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000099',
  sequence: 7,
  eventType: 'workflow_run.created',
  actor: {
    type: 'user',
    userId: '00000000-0000-4000-8000-000000000002',
  },
  primaryEntity: { kind: 'workflow_run', id: 'run-1' },
  relatedEntities: [],
  occurredAt: '2026-08-06T01:00:00.000Z',
  sourceId: 'workflow-run-create',
  payload: {
    schemaVersion: 1,
    workflowRunId: 'run-1',
    workflowVersionId: 'version-1',
  },
};

describe('Audit trail UI', () => {
  beforeEach(() => {
    listAuditEvents.mockReset();
    getAuditEvent.mockReset();
    verifyAuditTrail.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a typed audit event row without leaking forbidden keys', () => {
    render(
      <table>
        <tbody>
          <AuditEventRow
            event={baseEvent}
            href="/workspaces/x/audit/00000000-0000-4000-8000-000000000001"
          />
        </tbody>
      </table>,
    );
    expect(screen.getByText('workflow_run.created')).toBeInTheDocument();
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('password');
    expect(body).not.toContain('token');
    expect(body).not.toContain('secret');
    expect(body).not.toContain('screenshot');
  });

  it('renders an audit event detail with typed payload view only', () => {
    render(<AuditEventDetail event={{ ...baseEvent, payloadDigest: 'a'.repeat(64), previousHash: 'b'.repeat(64), eventHash: 'c'.repeat(64), createdAt: '2026-08-06T01:00:01.000Z' }} />);
    expect(screen.getByText(/Audit event #7/)).toBeInTheDocument();
    expect(screen.getByText(/workflow_run\.created/)).toBeInTheDocument();
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('expectedValue');
    expect(body).not.toContain('observedValue');
  });

  it('verify button calls control-plane and renders result', async () => {
    verifyAuditTrail.mockResolvedValueOnce({
      schemaVersion: 1,
      workspaceId: baseEvent.workspaceId,
      status: 'ok',
      checkedCount: 10,
      firstSequence: 1,
      lastSequence: 10,
      headHash: 'd'.repeat(64),
    });
    render(
      <AuditVerifyButton
        accessToken="token"
        workspaceId={baseEvent.workspaceId}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Verify audit chain' }));
    await waitFor(() => {
      expect(screen.getByText(/Status: ok/)).toBeInTheDocument();
    });
    expect(verifyAuditTrail).toHaveBeenCalledWith(
      'token',
      baseEvent.workspaceId,
      expect.objectContaining({ sampleLimit: expect.any(Number) }),
    );
  });

  it('verify button surfaces tamper state without leaking payload contents', async () => {
    verifyAuditTrail.mockResolvedValueOnce({
      schemaVersion: 1,
      workspaceId: baseEvent.workspaceId,
      status: 'tampered',
      checkedCount: 5,
      firstSequence: 1,
      lastSequence: 5,
      headHash: 'e'.repeat(64),
      firstFailure: { sequence: 4, kind: 'PAYLOAD_DIGEST_MISMATCH' },
    });
    render(
      <AuditVerifyButton
        accessToken="token"
        workspaceId={baseEvent.workspaceId}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Verify audit chain' }));
    await waitFor(() => {
      expect(screen.getByText(/Status: tampered/)).toBeInTheDocument();
    });
    expect(screen.getByText(/PAYLOAD_DIGEST_MISMATCH/)).toBeInTheDocument();
  });
});