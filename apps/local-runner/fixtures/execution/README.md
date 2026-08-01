# Local execution fixture

This loopback-only fixture exercises Navigate, Click, Fill, Select, SetChecked,
Wait, explicit URL/text/value/checked verification, and final form submission through the Session 19 workflow engine and
Playwright adapter. The workflow and runtime input JSON files are validated
before Chromium launches.

The server binds to `127.0.0.1` on an ephemeral port. It sends only an empty
completion signal to `/complete`; it does not transmit form values. All data
are fake and non-sensitive.

```powershell
pnpm --filter @tasktwin/local-runner build
pnpm --filter @tasktwin/local-runner execute-fixture -- --headed
pnpm --filter @tasktwin/local-runner execute-fixture -- --headed --fixture-wait-ms 10000
pnpm --filter @tasktwin/local-runner execute-fixture -- --fixture-wait-ms 10000 --total-timeout-ms 500
```

The command owns both server and browser lifecycles, emits only safe progress,
and waits for cleanup on success, failure, timeout, SIGINT, or SIGTERM.
