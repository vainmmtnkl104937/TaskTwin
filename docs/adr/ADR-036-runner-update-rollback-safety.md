# ADR-036: Runner update rollback safety

Status: Accepted

## Context

Keeping old executable bytes is necessary but insufficient for safe rollback.
The target may write a local-state or Local Secret Vault schema that the old
release cannot read. A target process may also fail between Windows SCM rebind
and the active-release record commit, leaving observations that cannot be
resolved from product versions alone.

Resuming a pre-update WorkflowRun would be especially unsafe: the browser
process and in-memory policy/secret context do not survive a process switch,
and a prior run lease must not authorize a new process.

## Decision

Apply evaluates compatibility in both directions before maintenance:

- Forward compatibility asks whether the target can read the currently
  persisted local-state and Local Secret Vault schema/protection profile.
- Projected rollback compatibility conservatively assumes the target may write
  every schema declared writable in its signed manifest, then asks whether the
  retained source can read that projected state.

Apply is allowed only for a newer release when both directions return
`compatible` and the controller's explicit Runner protocol, Workflow schema
and service/local-state axes are supported. Any required migration is blocked;
the updater never performs a Runner-state or vault migration.

Before any actual rollback, the controller:

1. Revalidates the retained source manifest, detached signature, exact ZIP,
   extracted allowlisted tree and ZIP-to-tree byte equality.
2. Re-inspects current local-state and vault schema/protection metadata.
3. Re-evaluates rollback compatibility against that current state.
4. Stops the failed target, rebinds only to the retained source activation,
   updates the active record and starts the source.
5. Requires the restored source to pass the same mandatory local health,
   including native secret auto-unlock when it was required.

Automatic rollback is attempted when a switched target fails startup or
mandatory target health and the source remains verified and compatible. A
temporarily unreachable Control Plane is not a rollback trigger. An explicit
`update_required` or `unsupported` acknowledgement is a target-health failure.

Manual `runner update rollback` can select only
`activeRelease.previousReleaseId`. It requires the Runner to be idle, verifies
the retained release and compatibility again, and has no arbitrary path or
force option. If the rollback target fails health, the controller attempts to
restore the release that was active when manual rollback began, subject to the
same proof and compatibility requirements.

Crash recovery combines the strict journal with the active-release record,
current SCM executable, retained proof, startup status and a fresh rollback
decision. Before switch, a clearly intact source becomes
`failed_before_switch` and incomplete staging is cleaned. After switch, a
healthy target completes; an unhealthy target rolls back only when safe. A
missing proof, unsafe/unknown rollback, mismatched binding or other ambiguous
observation enters the absorbing `manual_recovery_required` state.

No recovery decision contains WorkflowRun state or a lease. Every process
restart starts fresh; existing Control Plane lease-expiry and Interrupted
semantics handle abandoned work.

## Consequences

- Retaining a previous release is not a promise that rollback will always be
  possible. Current persisted state is authoritative at rollback time.
- Local state and vault schemas are not downgraded, rewritten or restored from
  updater backups.
- `manual_recovery_required` intentionally has no automatic transition and no
  `--force` escape. An operator must reconcile SCM selection, active metadata,
  signed proof and compatibility outside the controller.
- Retention keeps current and previous releases by default and protects all
  nonterminal journal participants. Nothing is automatically deleted during
  manual recovery.
- The controller is not a general disaster-recovery system and does not roll
  back a release for later workflow or business-level failures.
