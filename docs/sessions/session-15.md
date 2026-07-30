# Session 15: Playwright execution foundation

## Goal

Session 15 adds deterministic Chromium execution to the Local Runner for
validated local workflows. It does not connect execution to Control Plane
jobs.

## Included

- Playwright Library scoped to `apps/local-runner`
- Explicit Chromium-only installation
- Strict request, option, result, and safe-error contracts
- Workflow, input, secret, origin, locator, and timeout preflight
- One isolated non-persistent BrowserContext per execution
- Locator APIs with exactly-one-match enforcement
- Navigate, Click, Fill, Select, SetChecked, and bounded Wait
- Sequential fail-fast execution and explicit cleanup
- Deterministic loopback fixture
- Mocked unit tests and explicit real-Chromium tests

## Boundaries and behavior

`workflow-schema` remains the structural source of truth.
`workflow-inputs` provides deterministic variable compatibility and temporary
runtime-input validation. `locator-engine` continues to rank recorded
locators without DOM or Playwright access. Browser, BrowserContext, Page, and
Locator objects remain inside Local Runner.

Before launch the runner validates the complete request, unsupported steps,
secret requirements, values, bounded options, locators, and explicit origins.
Navigate accepts only HTTP/HTTPS URLs without credentials and checks both the
requested and final origin. Fill accepts string literals or variables. Select
uses option value only. SetChecked calls `locator.setChecked`. Secret sources
return `SECRET_RESOLUTION_UNAVAILABLE`.

Steps run only in array order and stop on the first failure. Normal Playwright
actionability and auto-wait apply without force, retry, locator repair,
arbitrary JavaScript, XPath, or custom selector engines.

Reports include identifiers, type, status, timing, locator kind, and fixed
error code. They omit input values, complete URLs, query parameters, cookies,
page content, and raw Playwright errors.

## Verification

```powershell
pnpm --filter @tasktwin/local-runner browser:install
pnpm --filter @tasktwin/local-runner test
pnpm --filter @tasktwin/local-runner test:browser
pnpm --filter @tasktwin/local-runner build
pnpm --filter @tasktwin/local-runner execute-fixture -- --headed
```

Default tests mock Playwright. Browser tests require the separately installed
Chromium binary.

## Excluded

WorkflowRun models, job polling, WebSocket, queues, persistent profiles, saved
authentication, personal Chrome profiles, secret resolution, file transfer,
Extract, Verify, Approval execution, screenshots, tracing, videos, retries,
locator repair, AI, scheduling, and parallel execution remain out of scope.
