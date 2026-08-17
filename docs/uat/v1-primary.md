# V1 UAT — Primary Scenarios

This is the repeatable User Acceptance Testing checklist for the
`v1.0.0-rc.1` release candidate. Each scenario is idempotent and can be re-run
against a fresh Docker Compose stack.

For every scenario record the result in the table below. Reference the manual
smoke runbook at `docs/uat/v1-smoke-test.md` for the exact command sequence.

## Conventions

- **Tester:** initials of the person who executed the scenario.
- **Date:** ISO date `YYYY-MM-DD`.
- **Result:** `Pass`, `Fail`, or `Skip` (with reason).
- **Notes:** short factual reference; never include runtime values, secrets,
  full URLs or PII.

## Pre-flight

Before starting, confirm:

- A fresh `docker compose up -d` Control Plane stack is running.
- Migrations are applied (`pnpm db:migrate:deploy`).
- A user account exists with `OWNER` membership on the default workspace.
- The Local Runner binary for `v1.0.0-rc.1` is available and trusted.
- The Chrome extension is loaded unpacked from `apps/extension/dist`.

## Scenarios

| # | Scenario | Tester | Date | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | First sign-in lands on the Workspaces home with a welcome checklist. | | | | |
| 2 | Pair a Local Runner and revoke it from Runner Devices. | | | | |
| 3 | Initialize the Local Secret Store and add one alias locally. | | | | |
| 4 | Record a browser task and convert it to a Draft. | | | | |
| 5 | Edit the Draft (add Approval and URL Verify steps, save). | | | | |
| 6 | Submit the Draft for Testing and Publish it. | | | | |
| 7 | Run the Published workflow with a real secret reference. | | | | |
| 8 | Resolve an Approval request from the Approval Center. | | | | |
| 9 | Create a daily schedule for a published workflow. | | | | |
| 10 | Repair a failed run from the Repair Center. | | | | |
| 11 | Verify the audit chain from the Audit page. | | | | |
| 12 | Create a three-stage fleet rollout and activate Stage 1. | | | | |

## Scenario detail

Each scenario is summarized below. The smoke runbook carries the exact
commands.

### 1. First sign-in

- Open `/` and click "Sign in".
- Sign in with the test user.
- Land on `/workspaces`. The default workspace is shown.
- The page shows a three-item welcome checklist (extension installed, Runner
  paired, Local Secret Store ready).

### 2. Pair and revoke a Local Runner

- Run `runner pair` on the Windows host. Note the user code.
- Open `/runner-pairing` and inspect then approve the code.
- The new Runner appears on `/workspaces/[id]/runner-devices`.
- Revoke the Runner. The card disappears from the list and the Runner can no
  longer claim work.

### 3. Initialize the Local Secret Store

- Re-pair the Runner if it was revoked.
- Run `runner secrets init` and confirm a passphrase.
- Run `runner secrets set api_key` (no-echo) and `runner secrets list`.
- The Runner Devices card reports `Local Secret Store: ready` with the alias
  visible.

### 4. Record → Draft

- Open the extension popup on a fixture page.
- Start recording, click and fill a few safe controls, stop.
- Convert to a Draft. The Draft appears in the workspace workflow list.

### 5. Edit the Draft

- Open the Draft editor.
- Add an Approval step, a URL Verify step, and Save.
- The save banner reports the new revision.

### 6. Publish

- Submit the Draft for Testing.
- Publish the Testing version. The version becomes immutable.

### 7. Run with a secret reference

- From the Version History page, start a Run on the published version.
- The Runner panel shows the compatible Runner. Prepare the encrypted inputs.
- Submit the run and confirm a `SUCCEEDED` terminal status.

### 8. Resolve an Approval

- Start a run on a workflow that includes the Approval step.
- The Approval Center shows the pending request with risk level and message.
- Approve from the detail page and confirm the run continues.

### 9. Create a daily schedule

- From `/schedules`, open the Create Schedule dialog.
- Pick the published workflow, the paired Runner, type `daily` and time `09:00`.
- Submit. The schedule appears in `active` status with a next-occurrence
  preview.

### 10. Repair a failed run

- Cause a deterministic failure (for example a navigation against a disallowed
  origin).
- The Repair Center surfaces a repair request.
- Retry the failed step; the run completes the remaining steps only.

### 11. Verify the audit chain

- Open `/audit/verify`.
- Click "Verify audit chain".
- The response shows `OK` with the chain head sequence and head hash.

### 12. Fleet rollout

- Confirm at least one Runner is paired and at least one available release is
  imported.
- Create a three-stage rollout at `/runner-rollouts` with explicit Runner IDs.
- Activate Stage 1. The stage moves to `active`, then `converged` once the
  Runner reports the target version in its heartbeat.

## Closing the run

After the run:

- File any failed scenario in `docs/uat/known-issues-v1.0.0-rc.1.md` with a
  severity from `docs/severity.md`.
- Promote a candidate to the next product release tag only when no P0 is open
  and no acceptance-critical P1 is open.