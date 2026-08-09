# Runner update crash recovery

`runner update recover` reconciles an interrupted local update from durable,
strict evidence. It does not infer success from a process exit code, SCM
`RUNNING` alone or product SemVer.

```powershell
runner.cmd update recover [--data-root <absolute-path>]
```

Recovery acquires the same exclusive update lease and reads:

- the versioned update journal and atomic active-release record;
- the SCM binary path;
- retained source and target signed proof plus extracted-tree verification;
- activation metadata and safe startup status;
- current local-state/vault schema and protection metadata;
- a freshly evaluated rollback-safety decision.

It never reads a WorkflowRun for resumption and does not persist or reuse a run
lease.

## Deterministic decisions

| Observation                                                                                       | Result                                                                                    |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| No journal or a normal terminal state                                                             | Return current safe status; no installation action                                        |
| Before switch, SCM and active record clearly select source                                        | Remove incomplete target/staging, ensure source is started, finish `failed_before_switch` |
| During switch, source is still clearly selected                                                   | Finish `failed_before_switch`                                                             |
| Target selected and health pending                                                                | Continue bounded target verification                                                      |
| Target selected and healthy                                                                       | Complete `succeeded` and apply bounded retention                                          |
| Target selected and unhealthy, source verified and rollback safe                                  | Continue automatic rollback                                                               |
| Rollback in progress, source selected and healthy                                                 | Complete `rolled_back`                                                                    |
| Rollback in progress, target still selected and rollback safe                                     | Retry the constrained rollback                                                            |
| Missing proof, unknown/unsafe rollback, neither/both release observations or inconsistent records | Enter `manual_recovery_required`                                                          |

Recovery revalidates retained releases before using them. A target is healthy
only when SCM selection, activation/startup attempt, exact software identity,
component probes, no active work, closed claim admission and any required
native secret unlock all agree. Control Plane `offline` or `not_attempted` is
not a local failure; explicit `update_required` or `unsupported` is.

## Manual recovery

`manual_recovery_required` is absorbing in the state machine. Re-running
`recover`, `apply` or `rollback` does not force a selection, delete retained
releases or rewrite schemas. There is deliberately no force flag.

An operator must preserve all evidence and reconcile, outside the automatic
controller:

1. the current SCM `binPath` and service state;
2. `active-release.v1.json` generation/current/previous/activation IDs;
3. the last valid journal revision and failure code;
4. retained manifest/signature/ZIP and activation bindings;
5. current local-state and vault schema/protection compatibility;
6. startup status for the candidate activation.

Do not edit the vault, active pointer or journal merely to make parsing pass,
and do not launch an arbitrary retained binary. Restore only through a reviewed
machine recovery procedure that independently establishes release proof,
state compatibility and service binding. TaskTwin supplies no automatic vault
backup, state downgrade or journal repair command.

Because a process crash destroys the browser and in-memory policy/secret
context, an old WorkflowRun remains subject to the existing Control Plane
lease-expiry/Interrupted semantics. Recovery starts no browser and creates no
replacement run.
