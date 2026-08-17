# Known issues — v1.0.0-rc.1

This register tracks open defects and accepted limitations for the
`v1.0.0-rc.1` release candidate. Severities follow `docs/severity.md`.

## Status legend

- **Open** — defect not yet fixed in the candidate.
- **Triaged** — root cause understood; fix tracked in a future session.
- **Closed** — fixed in this candidate or accepted as a limitation outside
  V1 scope.

## Limitations inherited from prior sessions

These limitations were explicitly out of scope of the V1 browser-first MVP and
are not V1 release blockers. They are recorded for transparency.

| ID | Area | Description | Severity | Status | Workaround |
| --- | --- | --- | --- | --- | --- |
| LIM-01 | Browser automation | No desktop automation, arbitrary JavaScript, remote shell, screenshots, persistent personal browser profiles or cloud Runner execution. | n/a | Open | Documented in `README.md` and `docs/product/PRODUCT.md`. |
| LIM-02 | Workflow engine | No branching, loops, parallel steps, crash resume or automatic retry of uncertain or mutating effects. | n/a | Open | Documented in `docs/ai/INVARIANTS.md`; intentional fail-closed behavior. |
| LIM-03 | Operational alerts | In-app only. No public metrics, distributed tracing, external APM/SIEM, infrastructure auto-remediation. | n/a | Open | Documented in `docs/product/ROADMAP.md`. |
| LIM-04 | Production Runner artifacts | Windows x64 only. Trusted public key registry empty until deployment provisions reviewed public keys. | n/a | Open | Documented in `apps/local-runner/README.md` and `docs/runner-version.md`. |
| LIM-05 | Runner update | No discovery feed, GitHub polling, background download, automatic install, schema migration, remote installation or remote rollback. | n/a | Open | Documented in `docs/runner-update.md`. |
| LIM-06 | Fleet rollout | No percentage or random cohorts, automatic stage promotion, auto-remediation or forced downgrade. | n/a | Open | Documented in `docs/runner-rollout-operations.md`. |
| LIM-07 | Production deployment | Single-host Docker Compose. No reverse proxy, managed TLS, database HA, point-in-time recovery, automatic off-host backup copy, image publishing, autoscaling, multi-region or cloud-specific infrastructure. | n/a | Open | Documented in `docs/control-plane-production-deployment.md`. |
| LIM-08 | Abuse limits | In-memory per API process. No distributed limiter, edge WAF, CAPTCHA, SSO, external SIEM or automated dependency remediation. | n/a | Open | Documented in `docs/ai/CURRENT_STATE.md`. |
| LIM-09 | Performance baseline | Intentionally small and local; not a production-capacity model. | n/a | Open | Workload-specific load tests are out of scope for V1. |

## Defects found during UAT for v1.0.0-rc.1

This section is empty at the time the RC is cut. Each defect reported during
the `v1-primary.md` run is recorded here with a severity and an owner.

| ID | Title | Scenario | Severity | Status | Owner | Notes |
| --- | --- | --- | --- | --- | --- | --- |

## V1 release blockers

This section is empty at the time the RC is cut. Promotion to `v1.0.0` is
blocked by any P0 entry here, and by any acceptance-critical P1.

| ID | Title | Severity | Status | Owner | Notes |
| --- | --- | --- | --- | --- | --- |