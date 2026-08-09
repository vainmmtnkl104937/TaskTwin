# Runner and Control Plane compatibility

TaskTwin separates product SemVer from execution and persisted-data contracts.
The current axes are:

- product release SemVer
- run/Runner protocol version
- Workflow definition schema version
- aggregate local Runner-state schema version
- Local Secret Vault schema and protection profile

`RUNNER_PROTOCOL_SCHEMA_VERSION` versions the strict pairing/heartbeat envelope;
it is not the job execution compatibility version. The reported Runner protocol
is the existing `RUN_PROTOCOL_VERSION`.

The initial deployed protocol policy preserves existing source-built Runner
support on canonical Windows, macOS and Linux identities and x64/arm64
architectures. All supported targets require run protocol 2, Workflow schema 1
and local-state schema 1. Session 31 publishes a production release artifact
only for Windows/x64; protocol compatibility on another target does not imply
that a release artifact is available for it. Product versions below the initial
minimum `0.1.0` require an update; the initial recommended version is also
`0.1.0`. When a future deployed policy raises the recommendation while
retaining a lower supported floor, that supported band receives
`update_recommended`. These product thresholds remain policy inputs, not
substitutes for the explicit compatibility axes.

## Reported identity

New Runner heartbeats report only product/version, run protocol, Workflow
schema, local-state schema and canonical platform/architecture. Source commit,
installation paths, hostname, service account, CI information, signing data and
vault information do not cross the boundary. Legacy heartbeat shape remains
authenticatable, but incomplete identity is `update_required` and cannot claim.
The strict heartbeat rejects a nested product version that differs from its
existing top-level `runnerVersion`.

The persistence adapter maps existing paired platform values `win32` and
`darwin` to canonical `windows` and `macos` identities. The release verifier and
upgrade preflight still accept only a signed Windows/x64 artifact in Session 31.

The Control Plane persists the last accepted identity and derives compatibility
from its compiled policy. Status is not persisted and there is no release
catalog:

- `compatible`: explicit contracts match and version meets recommendation.
- `update_recommended`: contracts match and the version remains supported.
- `update_required`: identity is incomplete or below the supported floor.
- `unsupported`: a product, target, protocol or schema axis is incompatible.

Only `compatible` and `update_recommended` may claim. Revocation, Workspace,
lease, policy, capability and secret-inventory checks still apply. Matching or
new SemVer never overrides an incompatible protocol/schema.

Scheduled occurrences use the same evaluator transactionally. An assigned
Runner that is update-required or unsupported creates no executable run; the
occurrence is skipped, the Schedule auto-pauses with
`runner_update_required`, and the existing Schedule Auto-Paused audit/alert
path is used.
`update_recommended` remains dispatch-eligible, just as it remains
claim-eligible.

## Runner defense

The Control Plane gate is not the only defense. Claimed jobs carry explicit run
protocol and Workflow schema metadata. The Runner strictly validates both and
the Workflow definition before policy preparation, secure-input resolution,
Playwright loading or Chromium launch. There is no compatibility override.
