import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { decideApprovalAction } = vi.hoisted(() => ({
  decideApprovalAction: vi.fn(async () => undefined),
}));

vi.mock(
  '../app/(authenticated)/workspaces/[workspaceId]/approvals/actions',
  () => ({ decideApprovalAction }),
);

import { ApprovalDecisionButtons } from '../app/(authenticated)/workspaces/[workspaceId]/approvals/approval-decision-buttons';

describe('ApprovalDecisionButtons', () => {
  beforeEach(() => {
    decideApprovalAction.mockClear();
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: vi.fn(() => true),
    });
  });

  it('requires confirmation before an approve decision', () => {
    render(
      <ApprovalDecisionButtons
        workspaceId="00000000-0000-4000-8000-000000000021"
        approvalRequestId="00000000-0000-4000-8000-000000000022"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(decideApprovalAction).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'approve' }),
    );
  });

  it('does not decide when confirmation is declined', () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(
      <ApprovalDecisionButtons
        workspaceId="00000000-0000-4000-8000-000000000021"
        approvalRequestId="00000000-0000-4000-8000-000000000022"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(decideApprovalAction).not.toHaveBeenCalled();
  });
});
