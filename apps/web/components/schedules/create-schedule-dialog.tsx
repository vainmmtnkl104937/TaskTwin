'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { createWorkflowScheduleAction } from '@/components/schedules/schedule-actions';
import { COMMON_TIMEZONES } from '@/lib/schedule-contracts';

type ScheduleType = 'one_time' | 'daily' | 'weekly';

interface CreateScheduleDialogProps {
  workspaceId: string;
}

interface WorkflowOption {
  id: string;
  name: string;
  versionId: string;
  version: number;
}

interface RunnerOption {
  id: string;
  name: string;
  status: string;
}

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

function today(): string {
  return new Date().toISOString().split('T')[0]!;
}

function toLocalDateString(date: Date): string {
  return date.toISOString().split('T')[0]!;
}

function previewNextOccurrence(
  type: ScheduleType,
  date: string,
  time: string,
  timezone: string,
  weekdays: number[],
  intervalDays: number,
  intervalWeeks: number,
): string {
  if (type === 'one_time') {
    return `${date} at ${time} (${timezone})`;
  }
  const now = new Date();
  const [hours, minutes] = time.split(':').map(Number);

  if (type === 'daily') {
    const next = new Date(date);
    next.setHours(hours ?? 0, minutes ?? 0, 0, 0);
    while (next <= now) {
      next.setDate(next.getDate() + intervalDays);
    }
    return `${toLocalDateString(next)} at ${time} (${timezone})`;
  }

  // weekly
  const targetWeekday = weekdays[0] ?? 1;
  const currentWeekday = now.getDay() === 0 ? 7 : now.getDay();
  let daysUntil = targetWeekday - currentWeekday;
  if (daysUntil < 0) daysUntil += 7;

  const nextOccurrence = new Date(now);
  nextOccurrence.setDate(nextOccurrence.getDate() + daysUntil);
  nextOccurrence.setHours(hours ?? 0, minutes ?? 0, 0, 0);

  while (nextOccurrence <= now) {
    nextOccurrence.setDate(nextOccurrence.getDate() + 7 * intervalWeeks);
  }

  return `${toLocalDateString(nextOccurrence)} at ${time} (${timezone})`;
}

export function CreateScheduleDialog({ workspaceId }: CreateScheduleDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Data
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [runners, setRunners] = useState<RunnerOption[]>([]);

  // Form state
  const [name, setName] = useState('');
  const [workflowVersionId, setWorkflowVersionId] = useState('');
  const [runnerDeviceId, setRunnerDeviceId] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('daily');
  const [timezone, setTimezone] = useState('UTC');
  const [date, setDate] = useState(today());
  const [time, setTime] = useState('09:00');
  const [endDate, setEndDate] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [intervalDays, setIntervalDays] = useState(1);
  const [intervalWeeks, setIntervalWeeks] = useState(1);

  const nameRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [workflowsRes, runnersRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/workflows`),
        fetch(`/api/workspaces/${workspaceId}/runners`),
      ]);

      if (workflowsRes.ok) {
        const workflowsData = await workflowsRes.json();
        setWorkflows(workflowsData.workflows ?? []);
        // Set default workflow version if not already set
        const fetchedWorkflows = workflowsData.workflows ?? [];
        if (fetchedWorkflows.length > 0 && !workflowVersionId) {
          setWorkflowVersionId(fetchedWorkflows[0].versionId);
        }
      }

      if (runnersRes.ok) {
        const runnersData = await runnersRes.json();
        // Filter runners with scheduled_execution capability
        const schedulableRunners = (runnersData.runners ?? []).filter(
          (r: { capabilities: string[] }) => r.capabilities?.includes('scheduled_execution_v1'),
        );
        setRunners(schedulableRunners);
        // Set default runner if not already set
        if (schedulableRunners.length > 0 && !runnerDeviceId) {
          setRunnerDeviceId(schedulableRunners[0].id);
        }
      }
    } catch {
      // Ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, [workspaceId, workflowVersionId, runnerDeviceId]);

  const openDialog = useCallback(() => {
    setOpen(true);
    setTimeout(() => nameRef.current?.focus(), 50);
    if (workflows.length === 0) {
      loadData();
    }
  }, [loadData, workflows.length]);

  const closeDialog = useCallback(() => {
    setOpen(false);
    setMessage('');
    setName('');
    setWorkflowVersionId(workflows[0]?.versionId ?? '');
    setRunnerDeviceId(runners[0]?.id ?? '');
    setScheduleType('daily');
    setTimezone('UTC');
    setDate(today());
    setTime('09:00');
    setEndDate('');
    setWeekdays([1]);
    setIntervalDays(1);
    setIntervalWeeks(1);
  }, [workflows, runners]);

  function toggleWeekday(value: number) {
    setWeekdays((current) => {
      if (current.includes(value)) {
        if (current.length === 1) return current;
        return current.filter((v) => v !== value);
      }
      return [...current, value].sort((a, b) => a - b);
    });
  }

  function buildDefinition(): object {
    const base = {
      schemaVersion: 1,
      timezone,
      time,
    };

    switch (scheduleType) {
      case 'one_time':
        return { ...base, type: 'one_time', date };
      case 'daily':
        return {
          ...base,
          type: 'daily',
          startDate: date,
          endDate: endDate || undefined,
          intervalDays,
        };
      case 'weekly':
        return {
          ...base,
          type: 'weekly',
          startDate: date,
          endDate: endDate || undefined,
          weekdays,
          intervalWeeks,
        };
    }
  }

  const nextPreview = previewNextOccurrence(
    scheduleType,
    date,
    time,
    timezone,
    weekdays,
    intervalDays,
    intervalWeeks,
  );

  const isFormValid =
    name.trim().length > 0 &&
    workflowVersionId.length > 0 &&
    runnerDeviceId.length > 0 &&
    date.length > 0 &&
    time.length > 0 &&
    (scheduleType !== 'weekly' || weekdays.length > 0) &&
    (scheduleType !== 'one_time' || date >= today());

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isFormValid) return;

    setPending(true);
    setMessage('');

    const result = await createWorkflowScheduleAction({
      workflowVersionId,
      clientScheduleId: crypto.randomUUID(),
      name: name.trim(),
      definition: buildDefinition(),
      runnerDeviceId,
    });

    setPending(false);

    if (!result.ok) {
      setMessage(result.message);
      return;
    }

    closeDialog();
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={openDialog}>
        Create schedule
      </button>

      {open ? (
        <div
          className="dialog-backdrop"
          onClick={(e) => e.target === e.currentTarget && closeDialog()}
        >
          <section
            className="run-inputs-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-schedule-heading"
          >
            <form onSubmit={handleSubmit}>
              <div className="row-heading">
                <div>
                  <p className="eyebrow">New schedule</p>
                  <h2 id="create-schedule-heading">Create Schedule</h2>
                </div>
                <button type="button" onClick={closeDialog}>
                  Cancel
                </button>
              </div>

              {loading ? (
                <p className="metadata">Loading workflows and runners...</p>
              ) : null}

              <label>
                Schedule name
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Daily backup at 9am"
                  maxLength={120}
                  required
                />
              </label>

              <label>
                Workflow
                <select
                  value={workflowVersionId}
                  onChange={(e) => setWorkflowVersionId(e.target.value)}
                  required
                >
                  <option value="">Select a workflow...</option>
                  {workflows.map((wf) => (
                    <option key={wf.versionId} value={wf.versionId}>
                      {wf.name} (v{wf.version})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Local Runner
                <select
                  value={runnerDeviceId}
                  onChange={(e) => setRunnerDeviceId(e.target.value)}
                  required
                >
                  <option value="">Select a runner...</option>
                  {runners.map((runner) => (
                    <option key={runner.id} value={runner.id}>
                      {runner.name} ({runner.status})
                    </option>
                  ))}
                </select>
              </label>
              {runners.length === 0 && !loading ? (
                <p className="inline-error">
                  No runners with scheduled execution capability found. Please pair a runner
                  first.
                </p>
              ) : null}

              <fieldset>
                <legend>Schedule type</legend>
                <div className="button-group">
                  <button
                    type="button"
                    onClick={() => setScheduleType('one_time')}
                    className={scheduleType === 'one_time' ? 'selected' : ''}
                  >
                    One-time
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleType('daily')}
                    className={scheduleType === 'daily' ? 'selected' : ''}
                  >
                    Daily
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleType('weekly')}
                    className={scheduleType === 'weekly' ? 'selected' : ''}
                  >
                    Weekly
                  </button>
                </div>
              </fieldset>

              <label>
                Timezone
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {COMMON_TIMEZONES.map((tz: string) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Time (HH:MM)
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                />
              </label>

              {scheduleType === 'one_time' ? (
                <label>
                  Date
                  <input
                    type="date"
                    value={date}
                    min={today()}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </label>
              ) : (
                <>
                  <label>
                    Start date
                    <input
                      type="date"
                      value={date}
                      min={today()}
                      onChange={(e) => setDate(e.target.value)}
                      required
                    />
                  </label>

                  <label>
                    End date (optional)
                    <input
                      type="date"
                      value={endDate}
                      min={date}
                      onChange={(e) => setEndDate(e.target.value)}
                      placeholder="Leave blank for no end"
                    />
                  </label>

                  {scheduleType === 'daily' && (
                    <label>
                      Repeat every N days
                      <input
                        type="number"
                        value={intervalDays}
                        min={1}
                        max={365}
                        onChange={(e) =>
                          setIntervalDays(Math.max(1, parseInt(e.target.value) || 1))
                        }
                      />
                    </label>
                  )}

                  {scheduleType === 'weekly' && (
                    <>
                      <fieldset>
                        <legend>Days of week</legend>
                        <div className="button-group">
                          {WEEKDAY_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => toggleWeekday(opt.value)}
                              className={weekdays.includes(opt.value) ? 'selected' : ''}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </fieldset>

                      <label>
                        Repeat every N weeks
                        <input
                          type="number"
                          value={intervalWeeks}
                          min={1}
                          max={52}
                          onChange={(e) =>
                            setIntervalWeeks(Math.max(1, parseInt(e.target.value) || 1))
                          }
                        />
                      </label>
                    </>
                  )}
                </>
              )}

              <div className="info-banner" style={{ marginTop: '1rem' }}>
                <strong>Next occurrence preview:</strong> {nextPreview}
              </div>

              <div style={{ marginTop: '1rem' }}>
                <button
                  type="submit"
                  disabled={pending || !isFormValid || runners.length === 0}
                >
                  {pending ? 'Creating...' : 'Create schedule'}
                </button>
                {message === '' ? null : (
                  <p className="inline-error" style={{ marginTop: '0.5rem' }}>
                    {message}
                  </p>
                )}
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
