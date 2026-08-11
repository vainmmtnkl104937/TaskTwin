# TaskTwin Invariants

These are durable safety and correctness boundaries. Current code, schemas,
migrations and tests define their exact implementation.

## Workflow

- `WorkflowDefinition.steps` is the sole execution-order authority.
- Published `WorkflowVersion` definitions are immutable.
- Editing Published or Archived work creates a new Draft; production workflow
  content is never silently repaired or rewritten.
- External workflow data is runtime-validated; TypeScript types alone are not a
  trust boundary.

## Execution

- Execution is deterministic, sequential and fail-fast unless an explicit
  current recovery rule applies.
- A Runner has at most one active `WorkflowRun` where enforced by the current
  dispatch architecture.
- Run claims are bound to the assigned authenticated Runner and a renewable
  hashed lease.
- Expired leases are not reused. Interrupted or crashed runs are not silently
  resumed, requeued or replayed.
- Browser runs use isolated non-persistent contexts and explicit allowed
  origins; personal browser profiles and saved authentication are not reused.
- Runtime outputs are ephemeral Runner memory and are cleared on every terminal
  path.

## Policy and approval

- Policy is deterministic, versioned and pinned to a run.
- Deny wins. Approval never overrides deny.
- AI, Web input and Runner payloads cannot bypass or supply a policy override.
- Approval gates only the explicitly bound immediate next step and fails closed
  on expiry, cancellation, lease loss or Runner revocation.

## Recovery and repair

- Unknown or possibly mutating side-effect certainty is never automatically
  retried.
- Mutating browser actions are not automatically retried unless an existing
  explicit safety rule proves that behavior safe.
- Automatic retry is bounded and limited to eligible transient read-only
  failures.
- Attended repair retains the current run context; it does not create crash
  resume semantics.
- Locator repair is privacy-filtered, tested read-only and can update only an
  explicit compatible Draft. It never mutates active or Published execution.

## Secrets and runtime data

- The Control Plane never receives plaintext local secret values or Runner
  private keys.
- Secret-value hashes are not used as a Control Plane substitute for secret
  values.
- Scheduled secret execution pins safe inventory metadata and resolves values
  locally from the Local Secret Store.
- There is no environment-variable fallback for scheduled secret values.
- Runtime variables are encrypted to the assigned Runner and decrypted only in
  local memory.

## Scheduling

- Schedule occurrences are database-idempotent and pinned to an immutable
  WorkflowVersion.
- Policy is re-evaluated for each occurrence.
- Missed windows have no automatic backfill, and ambiguous outcomes pause for
  human review rather than retrying.
- Scheduled execution requires truthful unattended Runner readiness and needed
  capabilities.

## Audit, alerts and privacy

- Audit events are append-only, hash-chained and appended in the same
  transaction as their domain mutation.
- Never persist runtime inputs, secret values, ephemeral output values, raw
  locators, full sensitive URLs, raw browser content, screenshots, tokens or
  raw errors in Audit, Alerts or Telemetry.
- Operational alerts use bounded typed metadata and idempotent delivery.
- Telemetry is aggregate and low-cardinality; IDs and versions are not public
  metric labels.

## Runner identity and software

- Runner authentication is separate from user authentication; revocation
  invalidates claims.
- Actual Runner software identity comes only from authenticated heartbeat.
- Compatibility is based on explicit protocol/schema/state contracts, never on
  whether a version is newest.
- There is no remote shell or arbitrary Control Plane command execution.
- Service restart or process crash starts fresh work and never resumes an old
  run lease or browser session.

## Release and update security

- Unsigned release metadata is never trusted. A release must pass strict
  manifest, trusted-key, detached-signature, digest and compatibility checks.
- Release acquisition accepts no user-provided URL. Metadata and artifact
  locations derive only from a static allowlisted HTTPS source and the verified
  signed manifest.
- Production signing private keys are never stored in the repository or
  Control Plane.
- Release history and signed manifest identity are immutable.
- Partial downloads are isolated and never supplied to update. Resume requires
  exact signed identity, local byte count, a strong ETag and exact range
  semantics; final size and SHA-256 verification precede atomic cache promotion.
- Local update verifies before installation mutation and executes no
  archive-supplied script.
- Acquisition leaves downloaded files inert and never automatically invokes
  installation, service mutation, shell execution or rollback.
- Update drains active work rather than cancelling it solely for maintenance.
- Rollback requires retained trusted proof and current compatibility; unsafe or
  ambiguous rollback is blocked for manual recovery.

## Fleet rollout

- Desired version is declarative state, not an update/install/rollback command.
- Each rollout belongs to one Workspace, targets one available trusted release
  and uses ordered stages with explicit Runner membership.
- A Runner appears in at most one stage per rollout and cannot hold conflicting
  active desired assignments.
- Stage progression is manual; there is no automatic or forced promotion.
- Convergence and rollback observation come from authenticated Runner software
  identity, never a client-supplied success boolean.
- The Control Plane does not download, install, execute or remotely roll back
  Runner software.
- Blocking a target pauses progression; it does not remotely downgrade a
  converged Runner. Actual blocked software cannot claim new work.
