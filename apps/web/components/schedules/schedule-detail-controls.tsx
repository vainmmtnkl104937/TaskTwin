'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  pauseWorkflowScheduleAction,
  resumeWorkflowScheduleAction,
  archiveWorkflowScheduleAction,
} from '@/components/schedules/schedule-actions';
import type { WorkflowScheduleStatus } from '@/lib/control-plane-contracts';

export function ScheduleDetailControls({
  scheduleId,
  status,
  canEdit,
}: {
  scheduleId: string;
  status: WorkflowScheduleStatus;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const canResume = status === 'PAUSED' || status === 'AUTO_PAUSED';
  const canPause = status === 'ACTIVE';
  const canArchive = status !== 'ARCHIVED';

  async function pause() {
    setPendingAction('pause');
    setMessage('');
    const result = await pauseWorkflowScheduleAction(scheduleId);
    setPendingAction(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    router.refresh();
  }

  async function resume() {
    setPendingAction('resume');
    setMessage('');
    const result = await resumeWorkflowScheduleAction(scheduleId);
    setPendingAction(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    router.refresh();
  }

  async function archive() {
    if (!confirm('Are you sure you want to archive this schedule? It cannot be resumed after archiving.')) {
      return;
    }
    setPendingAction('archive');
    setMessage('');
    const result = await archiveWorkflowScheduleAction(scheduleId);
    setPendingAction(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="button-group">
      {canPause && (
        <button
          disabled={!canEdit || pendingAction !== null}
          onClick={pause}
        >
          {pendingAction === 'pause' ? 'Pausing...' : 'Pause schedule'}
        </button>
      )}
      {canResume && (
        <button
          disabled={!canEdit || pendingAction !== null}
          onClick={resume}
        >
          {pendingAction === 'resume' ? 'Resuming...' : 'Resume schedule'}
        </button>
      )}
      {canArchive && (
        <button
          disabled={!canEdit || pendingAction !== null}
          onClick={archive}
          className="danger-button"
        >
          {pendingAction === 'archive' ? 'Archiving...' : 'Archive schedule'}
        </button>
      )}
      {message === '' ? null : <p className="inline-error">{message}</p>}
    </div>
  );
}
