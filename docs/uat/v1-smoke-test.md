# V1 Smoke Test — Operator Runbook

This runbook walks an operator through the minimum end-to-end smoke test for
`v1.0.0-rc.1`. The runbook assumes the portable production Control Plane from
`docker/control-plane.Dockerfile` and `compose.production.yaml`. The Local
Runner is tested on a Windows host.

The smoke test produces the evidence needed to fill in
`docs/uat/v1-primary.md`. Run it once before tagging `v1.0.0`.

## 1. Bring up the Control Plane

```shell
docker compose -f compose.production.yaml up -d --wait
docker compose -f compose.production.yaml ps
```

Confirm `migrate`, `api`, `web`, `scheduler`, `notification-worker` and
`postgres` are all `running` or `exited 0` for the one-shot migration.

## 2. Confirm readiness

```shell
curl -fsS http://127.0.0.1:3001/health/ready
curl -fsS http://127.0.0.1:3000/health/ready
```

Both must return `{"status":"ready", ...}`.

## 3. Create the test user

Use the API directly for deterministic seeding:

```shell
curl -fsS -X POST http://127.0.0.1:3001/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"uat@example.test","password":"correct horse battery staple"}'
```

Save the returned access token in an environment variable for the next steps.

## 4. Confirm the Workspaces home

Open `http://127.0.0.1:3000/workspaces` in a browser. Sign in with the test
user. Confirm:

- The default workspace appears.
- The welcome checklist is visible with three items: Extension installed,
  Runner paired, Local Secret Store ready.

## 5. Pair the Local Runner

On the Windows host with the trusted `v1.0.0-rc.1` Runner:

```powershell
runner version
runner pair --api-origin http://127.0.0.1:3001
```

Note the user code. Approve it in `/runner-pairing` and revoke it once to
confirm the revoke flow before re-pairing for the secret test.

## 6. Initialize the Local Secret Store

```powershell
runner secrets init
runner secrets set api_key
runner secrets list
```

The Runner Devices card on the Web must report `Local Secret Store: ready` with
one alias.

## 7. Record and convert

Open the Chrome extension on the local fixture, perform a short safe
interaction sequence, stop and convert. Confirm the Draft appears under the
workspace workflow list.

## 8. Edit, submit, publish

Open the Draft editor. Add an Approval step and a URL Verify step, save, then
submit for Testing and publish. Confirm the version becomes immutable.

## 9. Run with a real secret

Start a run on the published version. Prepare the encrypted inputs, submit and
confirm `SUCCEEDED` in the run detail.

## 10. Approval, schedule, repair, audit, fleet

Repeat the corresponding actions from the UAT checklist and confirm each
expected outcome.

## 11. Tear down

```shell
docker compose -f compose.production.yaml down --volumes
```

The smoke runbook produces no persistent state. Re-running it on a fresh stack
must always succeed without operator intervention beyond step 5.

## Reporting

For each scenario from `docs/uat/v1-primary.md` fill in the Tester, Date,
Result and Notes columns. File any failure in
`docs/uat/known-issues-v1.0.0-rc.1.md` before promoting the release tag.