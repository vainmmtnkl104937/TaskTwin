# TaskTwin Local Runner

The Local Runner pairs with the control plane, stores one revocable runner
credential locally, and sends heartbeats. Session 14 does not install
Playwright, launch a browser, fetch jobs, or execute workflows.

```powershell
pnpm --filter @tasktwin/local-runner build
pnpm --filter @tasktwin/local-runner pair -- --origin http://127.0.0.1:3001
pnpm --filter @tasktwin/local-runner status
pnpm --filter @tasktwin/local-runner start
pnpm --filter @tasktwin/local-runner unpair
```

Plain HTTP is accepted only for loopback development. Other origins must use
HTTPS. The runner displays only the user code and verification URL during
pairing; it never prints the device code or credential.

The development credential store writes atomically under the current user's
`.tasktwin` directory. POSIX directory and file modes are restricted to `0700`
and `0600`. Windows does not apply POSIX mode bits as a complete ACL guarantee,
so access also depends on the security of the Windows user profile. Native OS
keychain integration and credential rotation remain out of scope.
