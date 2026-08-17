# Session 40 — Release Candidate Preparation and UAT

TaskTwin is cut at `v1.0.0-rc.1` (recorded in `VERSION`) and stabilized for
User Acceptance Testing without weakening any security, privacy or policy
invariant.

The session ships the product release tag (`docs/RELEASE.md`), the V1 release
notes (`docs/releases/v1.0.0-rc.1.md`), the severity model
(`docs/severity.md`), a repeatable UAT checklist (`docs/uat/v1-primary.md`),
an operator smoke runbook (`docs/uat/v1-smoke-test.md`), a known-issues
register (`docs/uat/known-issues-v1.0.0-rc.1.md`) and a first-time Runner
onboarding guide (`docs/onboarding/v1-runner.md`).

The session tightens the Web UI for primary user journeys: the login page
surfaces an "expired session" banner, the Workspaces home shows a three-step
welcome checklist, heavy pages expose loading skeletons, the root error page
reports stable codes, the audit verify panel and Runner release catalog use
human-readable labels, the Fleet view adds a rollouts shortcut, the Run
Evidence panel reports Control Plane errors with stable codes, the Operations
dashboard normalizes enum labels, and the Draft editor adds an execution
policy digest.

No new product feature, dependency, public API or invariant is introduced in
this session.