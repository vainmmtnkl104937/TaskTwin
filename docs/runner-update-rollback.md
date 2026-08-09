# Runner update rollback

Rollback is a compatibility decision, not just selection of an older product
SemVer. The older executable must still be able to read every persisted schema
and protection profile that exists at the moment of rollback.

## Projected safety before apply

Before maintenance, apply evaluates Session 31 upgrade preflight twice:

- **Forward:** the target reads the current local-state schema and Local Secret
  Vault schema/protection profile without migration.
- **Rollback projection:** the retained source reads the target's signed
  writable local-state and vault schemas, conservatively assuming the target
  may write them during startup verification.

Both must return `compatible`. `migration_required`, `unsupported` and
`downgrade_blocked` results block apply. Product version ordering is checked
separately, and the target must be newer for `update apply`.

The projection is not a permanent guarantee. Immediately before switching
back, TaskTwin rereads safe local schema/protector metadata and repeats
rollback preflight against the state that actually exists.

## Automatic rollback

Automatic rollback is considered only after the service was switched and the
target fails to start or fails mandatory local health. It performs:

1. journal transition to `rolling_back`;
2. full revalidation of the previous release's retained signed proof, ZIP and
   extracted tree;
3. fresh rollback compatibility evaluation;
4. best-effort stop of the failed target;
5. SCM rebind and active-record switch to the previous activation;
6. previous service start and mandatory local health verification;
7. journal transition to `rolled_back`.

A locally healthy target is not rolled back merely because the Control Plane
is temporarily offline. A reachable explicit `update_required` or
`unsupported` acknowledgement is a target-health failure and can trigger the
same safe rollback flow.

Any missing source proof, current-state inspection failure, incompatible
schema, ambiguous service binding, rebind failure or restored-source health
failure ends in `manual_recovery_required`. The controller does not start an
old binary when compatibility cannot be proven.

## Manual rollback

```powershell
runner.cmd update rollback [--data-root <absolute-path>]
```

The only candidate is the verified release named by the active record's
`previousReleaseId`. The Runner must be idle; running, Approval-waiting,
Repair-waiting and nonterminal cancel-requested work block the command. The
controller revalidates proof and compatibility, switches to the retained
activation and verifies its health.

There is no target path, version, `--force`, migration or arbitrary executable
option. The command preserves the Local Secret Vault and protector metadata.
If the selected previous release fails health, TaskTwin tries to restore the
release that was active when rollback began, but only with the same current
proof/compatibility requirements.

Rollback never resumes a WorkflowRun and never reuses a lease. It is limited
to the current/previous managed pair and is not a state-backup or
disaster-recovery feature.
