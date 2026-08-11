# ADR-038: Operator-controlled Runner rollouts

## Status

Accepted for Session 33.

## Decision

A rollout belongs to exactly one Workspace, targets one available trusted
release and contains ordered stages with explicit Runner membership. A Runner
cannot occur twice in a rollout or own conflicting active desired assignments.
OWNER and ADMIN may mutate rollouts; MEMBER and VIEWER have read-only access.

Activation is declarative. A stage transaction revalidates release status,
membership, revocation, platform/architecture, ordering and conflicts, then
sets safe desired-release metadata. The protocol returns only desired version
and compliance status headers. It contains no executable, bytes, URL, path or
command.

Actual authenticated heartbeat identity is the convergence source. Stages
complete only when all active assignments converge, and the next stage always
requires explicit activation. A later report of the recorded previous version
is observed as rollback, moves the stage to `failed_review`, pauses the rollout
and alerts operators. It causes no retry or remote rollback.

Pausing blocks future activation and preserves existing assigned desired state.
Cancelling stops progression and clears only non-converged desired targets still
owned by that rollout. It does not downgrade already-converged Runners.

## Consequences

Rollouts express intent and review gates, not fleet automation. Actual updates
continue through the Session 32 local CLI. Percentage cohorts, automatic stage
promotion, auto-remediation, remote execution and forced downgrade remain out
of scope.
