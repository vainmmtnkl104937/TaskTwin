'use client';

import type { JSX } from 'react';
import type { SafeAuditEventDetail } from '../../lib/control-plane-contracts';

import { WorkflowLifecyclePayloadView } from './event-family/workflow-lifecycle-payload';
import { WorkflowVersionPayloadView } from './event-family/workflow-version-payload';
import { PolicyPayloadView } from './event-family/policy-payload';
import { RunPayloadView } from './event-family/run-payload';
import { ApprovalPayloadView } from './event-family/approval-payload';
import { RepairPayloadView } from './event-family/repair-payload';
import { LocatorRepairPayloadView } from './event-family/locator-repair-payload';
import { GenericPayloadView } from './event-family/generic-payload';

interface AuditEventDetailProps {
  event: SafeAuditEventDetail;
}

export function AuditEventDetail({ event }: AuditEventDetailProps): JSX.Element {
  return (
    <article>
      <header>
        <h1>Audit event #{event.sequence}</h1>
        <dl>
          <dt>Event type</dt>
          <dd>{event.eventType}</dd>
          <dt>Occurred at</dt>
          <dd>{event.occurredAt}</dd>
          <dt>Recorded at</dt>
          <dd>{event.createdAt}</dd>
          <dt>Source</dt>
          <dd>{event.sourceId}</dd>
          <dt>Correlation</dt>
          <dd>{event.correlationId ?? '—'}</dd>
          <dt>Payload digest</dt>
          <dd>{event.payloadDigest}</dd>
          <dt>Previous hash</dt>
          <dd>{event.previousHash}</dd>
          <dt>Event hash</dt>
          <dd>{event.eventHash}</dd>
        </dl>
      </header>
      <section>
        <h2>Actor</h2>
        <ActorView actor={event.actor} />
      </section>
      <section>
        <h2>Primary entity</h2>
        <p>
          {event.primaryEntity.kind}:{event.primaryEntity.id}
        </p>
      </section>
      <section>
        <h2>Payload</h2>
        <PayloadView eventType={event.eventType} payload={event.payload} />
      </section>
    </article>
  );
}

function ActorView({ actor }: { actor: SafeAuditEventDetail['actor'] }): JSX.Element {
  if (actor.type === 'user') {
    return <p>user: {actor.userId}</p>;
  }
  if (actor.type === 'runner') {
    return <p>runner device: {actor.runnerDeviceId}</p>;
  }
  return <p>system ({actor.reason})</p>;
}

function PayloadView({
  eventType,
  payload,
}: {
  eventType: SafeAuditEventDetail['eventType'];
  payload: SafeAuditEventDetail['payload'];
}): JSX.Element {
  if (
    eventType === 'workflow.created' ||
    eventType === 'workflow_draft.updated'
  ) {
    return <WorkflowLifecyclePayloadView payload={payload} />;
  }
  if (
    eventType === 'workflow_version.created' ||
    eventType === 'workflow_version.submitted_for_testing' ||
    eventType === 'workflow_version.returned_to_draft' ||
    eventType === 'workflow_version.published' ||
    eventType === 'workflow_version.archived'
  ) {
    return <WorkflowVersionPayloadView payload={payload} />;
  }
  if (eventType === 'policy_version.archived' || eventType === 'policy_version.activated') {
    return <PolicyPayloadView payload={payload} />;
  }
  if (
    eventType === 'workflow_run.created' ||
    eventType === 'workflow_run.claimed' ||
    eventType === 'workflow_run.started' ||
    eventType === 'workflow_run.waiting_for_approval' ||
    eventType === 'workflow_run.waiting_for_repair' ||
    eventType === 'workflow_run.cancel_requested' ||
    eventType === 'workflow_run.succeeded' ||
    eventType === 'workflow_run.failed' ||
    eventType === 'workflow_run.cancelled' ||
    eventType === 'workflow_run.timed_out' ||
    eventType === 'workflow_run.interrupted'
  ) {
    return <RunPayloadView payload={payload} />;
  }
  if (
    eventType === 'approval.requested' ||
    eventType === 'approval.decided' ||
    eventType === 'approval.lifecycle'
  ) {
    return <ApprovalPayloadView payload={payload} />;
  }
  if (
    eventType === 'repair.requested' ||
    eventType === 'repair.decided' ||
    eventType === 'repair.lifecycle'
  ) {
    return <RepairPayloadView payload={payload} />;
  }
  if (
    eventType === 'locator_repair.proposal_created' ||
    eventType === 'locator_repair.candidate_tested' ||
    eventType === 'locator_repair.applied_to_draft' ||
    eventType === 'locator_repair.dismissed'
  ) {
    return <LocatorRepairPayloadView payload={payload} />;
  }
  return <GenericPayloadView />;
}