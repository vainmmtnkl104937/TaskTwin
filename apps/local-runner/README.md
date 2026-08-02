# TaskTwin Local Runner

## Ephemeral extraction

The Playwright adapter supports text, field/select value, checked-state, and
safe URL extraction. Values are held only by the Workflow Engine's in-memory
output store and are never printed. Element extraction requires one unique
locator; password fields and unsafe URLs are rejected.
The Local Runner pairs with the control plane, stores one revocable runner
credential locally, sends heartbeats, claims at most one assigned workflow
run, renews its short-lived lease, and adapts the framework-independent
workflow engine to local Playwright execution.

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
sequentially through `@tasktwin/workflow-engine` and stop at the first failure.
Every source step receives a terminal result; unattempted steps are skipped
with a typed reason.

Verify reads current URL, normalized rendered text, visibility, non-password
field value, or checked state without mutating the page. It uses fixed bounded
polling, the step AbortSignal, and the smaller of its own timeout and the
engine's effective timeout. The Runner advertises
`workflow_verification_v1` only when this Playwright executor is available.
Verification results contain no observed or expected value.

Execution requires an explicit HTTP/HTTPS origin allowlist. Navigation rejects
credential-bearing URLs, unsafe schemes, disallowed destinations, and a final
redirect outside the allowlist. Locators must match exactly one element and
use normal Playwright actionability without force. Secret references fail
closed because secret resolution is not implemented.

Reports contain only safe step metadata and fixed error codes. Runtime values,
full URLs, query parameters, cookies, HTML, browser console payloads, and raw
Playwright errors are excluded.

An external AbortSignal handles SIGINT/SIGTERM cancellation. The total run
timeout covers Chromium startup and all steps, while each step receives an
effective timeout capped by remaining run time. Cancellation returns exit code
2, total timeout returns 3, other execution failure returns 1, and success
returns 0. The command awaits BrowserContext and Browser cleanup before setting
the process exit code.

Safe CLI progress contains only run/step identifiers and statuses. It never
prints values, full URLs, secrets, locators, DOM content, or raw Playwright
errors.

Plain HTTP is accepted only for loopback development. Other origins must use
HTTPS. The runner displays only the user code and verification URL during
pairing; it never prints the device code or credential.

The development credential store writes atomically under the current user's
`.tasktwin` directory. POSIX directory and file modes are restricted to `0700`
and `0600`. Windows does not apply POSIX mode bits as a complete ACL guarantee,
so access also depends on the security of the Windows user profile. Native OS
keychain integration and credential rotation remain out of scope.

Progress is sequenced and uploaded idempotently before one validated completion
is delivered. A cancellation request aborts the workflow engine and waits for
browser cleanup. A stopped Runner does not re-execute work; its expired lease
causes the Control Plane to mark the run Interrupted.

## Secure runtime inputs

The Runner creates a 3072-bit RSA key pair and registers only the SPKI public
key. Its PKCS8 private key is stored atomically at
`.tasktwin/runner-encryption-key.json`, is never printed or sent, and survives
restart. Corrupted key files fail closed. POSIX modes request `0600`; Windows
relies on the current user-profile ACL because mode bits are not a complete
Windows permission boundary.

Encrypted variables are authenticated and decrypted only after claim and
before Chromium starts. Attended TTY sessions advertise interactive secret
support and prompt declared aliases without echo or persistence. Secret leases
and decrypted variable references are disposed on every terminal path.
JavaScript strings cannot be guaranteed to be immediately zeroized.

File delivery, persistent secrets, automatic key rotation, OS keychains,
saved browser authentication, persistent profiles, retry/resume, screenshots,
tracing, AI and scheduling remain out of scope.

## Human approval gates

For `workflow_approval_v1`, the Runner creates one run-bound approval request,
polls at the bounded server interval, and keeps heartbeat and lease renewal
active. Playwright receives no Approval action. The existing BrowserContext
stays open but inactive until approval; every terminal outcome still waits for
browser cleanup. Approval messages and runtime values are not logged.

## Attended manual repair

Start with `--headed --attended` to advertise
`workflow_manual_repair_v1`. A run must also select
`automatic_safe_and_manual`. When an eligible pre-action or read-only failure
occurs, the Runner retains its BrowserContext, keeps heartbeat and lease
renewal active, performs no browser action, and polls the repair request. Retry
executes only the failed step; every terminal outcome closes browser resources.
Manual page changes are not fully audited and must never contain secrets.
