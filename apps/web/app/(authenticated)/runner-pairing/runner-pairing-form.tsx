'use client';

import { useActionState } from 'react';

import type { WorkspaceListResponse } from '@/lib/control-plane-contracts';

import { runnerPairingAction, type RunnerPairingActionState } from './actions';

const initialState: RunnerPairingActionState = { status: 'idle' };

export function RunnerPairingForm({
  workspaces,
}: {
  workspaces: WorkspaceListResponse['workspaces'];
}) {
  const [state, action, pending] = useActionState(
    runnerPairingAction,
    initialState,
  );
  const manageable = workspaces.filter(
    (workspace) => workspace.canManageRunners,
  );

  return (
    <form action={action} className="panel runner-pairing-form">
      <label>
        Pairing code
        <input
          name="userCode"
          defaultValue={state.userCode}
          autoComplete="off"
          maxLength={32}
          required
        />
      </label>
      {state.inspection === undefined ? (
        <button name="intent" value="inspect" disabled={pending}>
          Inspect runner
        </button>
      ) : (
        <>
          <section aria-label="Runner metadata" className="runner-metadata">
            <h2>{state.inspection.metadata.displayName}</h2>
            <p>
              {state.inspection.metadata.platform} ·{' '}
              {state.inspection.metadata.architecture} · version{' '}
              {state.inspection.metadata.runnerVersion}
            </p>
          </section>
          <label>
            Workspace
            <select name="workspaceId" required>
              <option value="">Select a workspace</option>
              {manageable.map((workspace) => (
                <option value={workspace.id} key={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
          <div className="button-group">
            <button name="intent" value="approve" disabled={pending}>
              Approve
            </button>
            <button
              className="danger-button"
              name="intent"
              value="deny"
              disabled={pending}
            >
              Deny
            </button>
          </div>
        </>
      )}
      {state.message !== undefined ? (
        <p
          className={state.status === 'error' ? 'error-banner' : 'metadata'}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
      {manageable.length === 0 ? (
        <p className="error-banner">
          OWNER or ADMIN access is required to approve a runner.
        </p>
      ) : null}
    </form>
  );
}
