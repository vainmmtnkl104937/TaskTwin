'use client';

import { useState, useTransition } from 'react';

import { revokeRunnerDeviceAction } from './actions';

export function RevokeRunnerButton(props: {
  runnerDeviceId: string;
  workspaceId: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button
        className="danger-button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm('Revoke this Local Runner?')) {
            return;
          }
          startTransition(async () => {
            const result = await revokeRunnerDeviceAction(props);
            if (result.ok) {
              window.location.reload();
            } else {
              setMessage(result.message ?? 'Runner could not be revoked.');
            }
          });
        }}
        type="button"
      >
        {pending ? 'Revoking…' : 'Revoke'}
      </button>
      {message === null ? null : (
        <p className="error-banner" role="alert">
          {message}
        </p>
      )}
    </>
  );
}
