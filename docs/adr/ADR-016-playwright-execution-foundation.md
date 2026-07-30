# ADR-016: Playwright execution foundation

- Status: Accepted
- Date: 2026-07-30

## Context

TaskTwin needs deterministic local browser execution without transferring
browser credentials, cookies, or page content to the Control Plane. The shared
workflow contract already defines linear order, value sources, and semantic
locators. Session 15 needs a browser boundary without adding Control Plane jobs
or persistent profiles.

## Decision

The Local Runner uses the maintained `playwright` Library package and installs
only Chromium. Vitest remains the test runner; `@playwright/test` is not added.

Every execution launches Chromium and creates one isolated non-persistent
context with `browser.newContext()`. It never calls
`launchPersistentContext`, supplies a user-data directory, imports cookies, or
loads storage state. Context and Browser close on success, failure,
cancellation, and partial initialization failure.

The full request is runtime-validated before launch: workflow structure,
variable references, runtime inputs, secret requirements, supported steps,
locator bounds, options, and an explicit HTTP/HTTPS origin allowlist.

Navigate, Click, Fill, Select, SetChecked, and Wait execute sequentially in
`WorkflowDefinition.steps` order and stop at the first error. There is no
retry, repair, refresh, or parallelism. Secret references fail closed.

The locator adapter uses Playwright Locator APIs, bounded semantic roles, and
exactly-one-match enforcement. XPath-like CSS, custom selector behavior,
workflow JavaScript, and `force` are rejected.

Results use fixed error codes and safe metadata. Values, full URLs, query
strings, cookies, HTML, console payloads, and raw Playwright errors are
excluded.

## Consequences

Dependency installation and `playwright install chromium` are separate steps.
The browser binary must be reinstalled after relevant Playwright upgrades.
Linux may need an explicit `--with-deps chromium` installation.

Every context starts unauthenticated. Persistent profiles, saved
authentication, Control Plane jobs, secret resolution, screenshots, traces,
retries, and run persistence require later decisions.
