# `@tasktwin/runner-update`

`@tasktwin/runner-update` contains the framework-independent contracts and
deterministic decisions used by TaskTwin's local Windows Runner update
controller. It does not install software or touch a machine.

The package has no filesystem, Windows API, service-manager, child-process,
database, web-framework, or Playwright dependency. Application adapters in
`apps/local-runner` are responsible for those boundaries.

## Trust and compatibility

An application must first verify the target manifest, detached signature, and
exact artifact with `@tasktwin/runner-release`. This package intentionally does
not accept unverified archive paths or provide signature, checksum,
compatibility, or rollback bypasses.

`evaluateRunnerUpdatePreflight` composes Session 31's
`evaluateUpgradePreflight` twice:

1. The target must read the currently persisted local-state and Local Secret
   Vault schemas and protection profile without migration.
2. The retained current release must be able to read every schema the target
   declares writable, using the existing vault protection profile.

Only a newer product SemVer with `compatible` results in both directions is
allowed. Product SemVer is release identity; the signed protocol and schema
declarations remain the source of compatibility truth. The evaluator is pure
and never migrates or writes state.

`evaluateRunnerInstallationCompatibility` separately proves the signed Runner
protocol, readable Workflow schema, and aggregate service/local-state schema
against the versions supported by the installed controller. This keeps these
axes explicit instead of inferring them from product SemVer.

`evaluateRunnerRollbackCompatibility` performs the same Session 31 preflight
against state inspected immediately before a switch-back. Automatic and manual
rollback must require its `safe` result; an initial projection is not a promise
that state remained unchanged.

`createRunnerUpdatePlan` accepts only an allowed bidirectional preflight and a
compatible installation evaluation. It produces a deterministic, path-free
apply plan that binds the source and target release IDs to their verified
manifest digests. Blocked or migration-required inputs cannot be represented as
a valid plan.

## Durable records

Strict Zod schemas cover:

- Installed, cryptographically identified releases.
- The current/previous active-release pointer.
- A bounded, privacy-safe update journal.
- Claim-disabled local startup-health reports.

Release IDs are `rr1_<manifest-sha256>`. Update IDs are
`ru1_<sha256-of-versioned-safe-inputs>` and require an injected SHA-256
implementation so the package remains runtime independent.

The installed-release record is an index, not independent proof. Before apply,
rollback, or recovery, the application must reverify the retained signed
manifest and exact archive and compare their projection with the record.

The journal permits only safe identifiers, versions, digests, timestamps, and
stable error codes. Paths, credentials, vault identifiers, protected key
metadata, claims, leases, and browser state have no contract fields.

## State machine

The successful apply sequence is:

```text
idle -> preparing -> draining -> staging -> ready_to_switch -> switching
     -> starting_target -> verifying_target -> succeeded
```

Pre-switch failures end in `failed_before_switch`. Post-switch health failures
may enter `rolling_back` and `rolled_back` only when rollback remains proven.
Ambiguous installation, health, or rollback evidence ends in the absorbing
`manual_recovery_required` state.

The state machine says which transition is valid. Atomic journal persistence,
exclusive update leasing, drain behavior, staging, service switching, and
rollback execution belong to the application boundary.

## Startup health and recovery

`evaluateTargetHealth` requires:

- The expected activation and startup-attempt IDs.
- Exact reported software identity and service executable selection.
- Runner instance-lock, Workflow Engine, Policy runtime, Chromium, and Local
  Secret Store initialization.
- OS-native secret auto-unlock when the previous installation required it.
- No active work and claim admission still closed during verification.

A temporarily unavailable Control Plane does not make a locally healthy target
fail. An explicit `update_required` or `unsupported` acknowledgement does.

`decideCrashRecovery` uses only a validated journal, observed source/target
selection, local health, and freshly evaluated rollback safety. It never
contains or reconstructs WorkflowRun state or a lease. Ambiguous observations
fail closed to manual recovery.

`decideReleaseRetention` protects the current release, previous release, and
nonterminal journal participants. It selects release IDs only; controlled path
resolution, link checks, and deletion remain application responsibilities. No
release is selected for removal during manual recovery.

## Safe summaries

`summarizeRunnerUpdate` and `summarizeInstalledRelease` expose bounded product
and operational metadata. They omit paths, signing-key metadata, signature and
artifact digests, machine identity, credentials, and vault/protected-key data.

## Non-goals

This package does not implement downloading, automatic state migration,
automatic installation, remote update or rollback commands, arbitrary script
execution, workflow resumption, or lease reuse. Session 32 supports only the
approved Windows x64 application adapter and the current/previous verified
release pair.
