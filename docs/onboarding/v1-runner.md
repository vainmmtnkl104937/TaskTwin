# V1 First-time Runner Onboarding

This guide walks a new operator through the minimum steps to make a fresh
TaskTwin deployment usable. It assumes the Control Plane is already running
per `docs/uat/v1-smoke-test.md`. Do not record browser activity before the
Local Runner is paired and the Local Secret Store is initialized.

## Before you begin

- A Trusted Local Runner build for `v1.0.0` is downloaded and verified
  per `docs/runner-release-packaging.md` and `docs/runner-version.md`.
- The Windows host has DPAPI-NG available (Windows 8 / Server 2012 or newer).
- The Control Plane API and Web origins are reachable from the Runner host.

## 1. Confirm the Runner build

```powershell
runner version
```

The output must report the Local Runner SemVer (`0.1.0`) and the expected
platform (`windows / x64`). The Output also carries the canonical
product release tag `v1.0.0` separately — heartbeat identification uses
the Runner SemVer; the product tag identifies the Control Plane release.

## 2. Pair the Runner with the Control Plane

```powershell
runner pair --api-origin http://control-plane.example.test:3001
```

The CLI prints a short user code. Do **not** share the device code.

## 3. Approve the pairing

In the Web UI:

1. Sign in as a user with `OWNER` or `ADMIN` membership on the workspace.
2. Open `/runner-pairing`.
3. Enter the user code shown by the Runner, click "Inspect runner", review
   the safe metadata, and click "Approve".

The Runner Devices card on the workspace now shows the new device as
`online`.

## 4. Initialize the Local Secret Store

Only required if scheduled execution will need secrets.

```powershell
runner secrets init
runner secrets set api_key
runner secrets list
```

The CLI prompts for the passphrase and the secret value without echo. The
Web Runner Devices card reports `Local Secret Store: ready` with the alias
visible.

## 5. Optional: install the Windows service

Use the production service flow described in
`docs/local-runner-service.md` and `docs/windows-runner-deployment.md`. The
service is recommended only after the interactive pairing and secret
initialization have succeeded.

## 6. Load the Chrome extension

Build the extension and load `apps/extension/dist` as an unpacked extension
in Chrome. The extension popup should report "Ready" with no recording
session active.

## 7. Record, review and run

Follow `docs/uat/v1-primary.md` for the full journey. The first workflow
should be a short, safe fixture that exercises a Navigate, a Click and a
Fill step.

## What to do if something fails

- Pairing rejects the user code: confirm the user code is current; codes
  expire quickly. Restart pairing from the Runner host.
- Secret Store status remains `unavailable`: run `runner secrets status`.
  Re-initialize if the vault file is missing or unreadable.
- The extension popup reports "Recorder not ready": reload the extension
  and confirm the active tab is bound to a permitted origin.
- The Workspaces home checklist stays red: the missing item describes the
  exact blocking step. Re-run only the missing step.

## Security reminders

- The Local Runner stores its credential locally under `.tasktwin`. Never
  share the contents of that directory.
- The user code alone is not a credential. It authorises a pairing session;
  the high-entropy device code never leaves the Runner.
- Secrets entered during `runner secrets set` are stored locally only. The
  Control Plane never receives plaintext secret values.