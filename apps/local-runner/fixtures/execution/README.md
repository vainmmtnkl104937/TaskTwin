# Local execution fixture

This loopback-only fixture exercises Session 15 Navigate, Click, Fill, Select,
SetChecked, Wait, and final form submission behavior. The workflow and runtime
input JSON files are validated before Chromium launches.

The server binds to `127.0.0.1` on an ephemeral port. It sends only an empty
completion signal to `/complete`; it does not transmit form values. All data
are fake and non-sensitive.

```powershell
pnpm --filter @tasktwin/local-runner build
pnpm --filter @tasktwin/local-runner execute-fixture -- --headed
```

The command owns both server and browser lifecycles and closes them on success,
failure, SIGINT, or SIGTERM.
