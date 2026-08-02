import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { decideRepairAction } = vi.hoisted(() => ({
  decideRepairAction: vi.fn(async () => undefined),
}));

vi.mock(
  '../app/(authenticated)/workspaces/[workspaceId]/repairs/actions',
  () => ({ decideRepairAction }),
);

import { RepairDecisionButtons } from '../app/(authenticated)/workspaces/[workspaceId]/repairs/repair-decision-buttons';

describe('RepairDecisionButtons', () => {
  beforeEach(() => {
    decideRepairAction.mockClear();
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: vi.fn(() => true),
    });
  });

  it('offers retry only when both the role and deterministic policy allow it', () => {
    render(
      <RepairDecisionButtons
        workspaceId="00000000-0000-4000-8000-000000000001"
        repairRequestId="00000000-0000-4000-8000-000000000022"
        canRetry
        canAbort
        retryAllowed={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Retry step' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Abort run' }));
    expect(decideRepairAction).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'abort' }),
    );
  });

  it('keeps retry hidden from a member while allowing abort', () => {
    render(
      <RepairDecisionButtons
        workspaceId="00000000-0000-4000-8000-000000000001"
        repairRequestId="00000000-0000-4000-8000-000000000022"
        canRetry={false}
        canAbort
        retryAllowed
      />,
    );
    expect(screen.queryByRole('button', { name: 'Retry step' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Abort run' })).toBeEnabled();
  });
});
