# Session 33: Trusted Runner releases and controlled fleet rollout

Session 33 adds a trusted Runner Release Catalog, an explicit compliance model,
and operator-controlled Workspace rollouts. The Control Plane stores desired
software state; it never downloads, installs, starts PowerShell, invokes the
local updater, executes a command, or forces a rollback. Runner update execution
remains an explicit local Session 32 CLI operation.

## Version meanings

- **Actual version** is authenticated software identity reported by a Runner
  heartbeat.
- **Desired version** is declarative Control Plane metadata owned by an active
  rollout assignment. It is not permission or an instruction to update.
- **Compatible version** is determined only by explicit protocol, workflow,
  engine, policy and platform contracts. It is never inferred from whether a
  version is newest.

## Release catalog

Only a Session 31 strict manifest with a valid detached signature from a
configured trusted public key can enter the catalog. Its canonical manifest
digest is the immutable identity. Retrying the exact signed manifest is
idempotent; reusing a product version with a different digest is a conflict.
Catalog history is immutable apart from the bounded `available`, `deprecated`
and `blocked` governance status and safe reason metadata. Private signing keys,
artifact bytes, paths and arbitrary download URLs are not stored.

## Rollout behavior

A rollout targets one available release in one Workspace and contains ordered,
explicit stages. Each Runner may occur in only one stage, and conflicting active
desired assignments are rejected. OWNER or ADMIN activates the rollout and each
stage manually. There is no percentage cohort, random selection, force-next or
automatic stage promotion.

Stage activation rechecks Workspace ownership, revocation, platform and
architecture, catalog availability, stage order and assignment conflicts in a
transaction. It changes desired-version metadata and assignment state only.
Pausing prevents future stage activation while preserving already assigned
desired state. Cancelling prevents progression, clears non-converged desired
targets when still owned by that rollout, and never downgrades a converged
Runner.

Authenticated heartbeat identity drives convergence. Reporting the target
version converges an assignment. If a converged Runner later reports its
recorded previous version, the assignment becomes `rolled_back`, the stage
becomes `failed_review`, and the rollout pauses. This observes a local rollback;
it does not perform one or retry automatically.

Blocking an active target pauses affected rollouts, prevents stage activation,
and creates one action-required alert for OWNER/ADMIN recipients. A Runner
actually running a blocked catalog release cannot claim new work. No automatic
downgrade occurs.

## Operator surfaces

The Fleet page shows actual, desired and compliance state together with
connection, runtime and service state. Rollout pages show ordered stages,
convergence totals and rollback review state. They deliberately expose no
Install, Update Now, remote shell, PowerShell or remote rollback control.

See [ADR-037](../adr/ADR-037-runner-release-catalog.md),
[ADR-038](../adr/ADR-038-controlled-runner-rollouts.md), the
[release governance guide](../runner-release-governance.md), the
[rollout operations guide](../runner-rollout-operations.md), and the
[Fleet UI guide](../web-runner-fleet.md).
