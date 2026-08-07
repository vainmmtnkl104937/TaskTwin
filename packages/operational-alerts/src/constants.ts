export const OPERATIONAL_ALERT_SCHEMA_VERSION = 1 as const;

export const OPERATIONAL_ALERT_TYPES = [
  'approval_required',
  'repair_required',
  'run_failed',
  'run_timed_out',
  'run_interrupted',
  'schedule_auto_paused',
  'audit_integrity_failed',
] as const;

export const OPERATIONAL_ALERT_SEVERITIES = [
  'info',
  'warning',
  'error',
  'critical',
] as const;

export const OPERATIONAL_ALERT_STATUSES = [
  'active',
  'resolved',
  'informational',
] as const;

export const OPERATIONAL_ALERT_SOURCE_TYPES = [
  'approval_request',
  'repair_request',
  'workflow_run',
  'workflow_schedule',
  'audit_verification_failure',
] as const;

export const OPERATIONAL_ALERT_ENTITY_TYPES = [
  ...OPERATIONAL_ALERT_SOURCE_TYPES,
  'workflow_version',
  'workflow_schedule_occurrence',
  'workspace_audit_chain',
] as const;

export const NOTIFICATION_CHANNELS = ['in_app'] as const;
export const MAX_ALERT_RECIPIENTS = 1_000;
