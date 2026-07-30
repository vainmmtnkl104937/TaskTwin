# TaskTwin Local Runner

The Local Runner pairs with the control plane, stores one revocable runner
credential locally, sends heartbeats, and provides the Session 15 local
Playwright execution foundation. Control Plane jobs are not connected yet.

```powershell
pnpm --filter @tasktwin/local-runner build
pnpm --filter @tasktwin/local-runner pair -- --origin http://127.0.0.1:3001
pnpm --filter @tasktwin/local-runner status
pnpm --filter @tasktwin/local-runner start
pnpm --filter @tasktwin/local-runner unpair
```

## Local Chromium execution

TaskTwin uses the Playwright Library from the `playwright` runtime package,
not the Playwright Test runner. Dependency installation and browser binary
installation are separate:

```powershell
pnpm install
pnpm --filter @tasktwin/local-runner browser:install
```

Only Chromium is installed. Linux hosts missing browser libraries may
explicitly run `playwright install --with-deps chromium`, which can require
administrator privileges.

```powershell
pnpm --filter @tasktwin/local-runner build
pnpm --filter @tasktwin/local-runner execute-fixture
pnpm --filter @tasktwin/local-runner execute-fixture -- --headed
pnpm --filter @tasktwin/local-runner test:browser
```

Each execution launches Chromium, creates one isolated non-persistent
`BrowserContext`, opens one `Page`, then closes both context and browser.
TaskTwin never supplies a personal profile path, imports cookies, or loads a
saved storage state. Navigate, Click, Fill, Select, SetChecked, and Wait run
sequentially and stop at the first failure.

Execution requires an explicit HTTP/HTTPS origin allowlist. Navigation rejects
credential-bearing URLs, unsafe schemes, disallowed destinations, and a final
redirect outside the allowlist. Locators must match exactly one element and
use normal Playwright actionability without force. Secret references fail
closed because secret resolution is not implemented.

Reports contain only safe step metadata and fixed error codes. Runtime values,
full URLs, query parameters, cookies, HTML, browser console payloads, and raw
Playwright errors are excluded.

Plain HTTP is accepted only for loopback development. Other origins must use
HTTPS. The runner displays only the user code and verification URL during
pairing; it never prints the device code or credential.

The development credential store writes atomically under the current user's
`.tasktwin` directory. POSIX directory and file modes are restricted to `0700`
and `0600`. Windows does not apply POSIX mode bits as a complete ACL guarantee,
so access also depends on the security of the Windows user profile. Native OS
keychain integration and credential rotation remain out of scope.

Control Plane job polling, WorkflowRun persistence, saved authentication,
persistent profiles, secret resolution, screenshots, tracing, retries, AI,
and scheduling remain out of scope.
