# Session 19: Deterministic outcome verification

Session 19 adds explicit, deterministic outcome verification to published
workflows while retaining the existing local execution and safe-reporting
boundaries.

## Included

- Framework-independent `@tasktwin/workflow-verification` contracts and rules
- An extended version 1 `VerifyStep` for URL, text, visibility, field value,
  and checked-state assertions
- Literal and compatible runtime-variable expectations
- Unique read-only element locators and bounded cancellable polling
- Playwright implementation inside the Local Runner adapter
- Workflow-engine preflight, fail-fast execution, cancellation, timeout, and
  cleanup integration
- Safe value-free step results
- `workflow_verification_v1` Runner capability and dispatch compatibility
- Explicit Verify-step controls in the Draft workflow editor

## Excluded

Visual comparison, regular expressions, custom JavaScript, XPath, automatic
verification generation, locator repair, page mutation, reload, screenshots,
AI, secret expectations, file expectations, and password-value verification
remain out of scope.

## Safety boundary

The engine validates each rule before adapter startup. The Playwright adapter
polls without mutating the page and stops on success, timeout, or cancellation.
Expected values, actual values, complete URLs, query strings, raw locators, DOM
content, and raw Playwright errors never appear in progress, final results,
persistence, or logs.

## Compatibility and persistence

Runners advertise verification support explicitly. A Verify workflow cannot be
prepared or dispatched to a Runner lacking `workflow_verification_v1`.
Workflows without Verify steps remain compatible and publish with a readiness
warning. No Prisma migration is needed: workflow definitions and existing
JSON final results already provide the required versioned storage boundary.

## Verification

Default tests cover contracts, normalization, semantic validation, locator
uniqueness, all supported assertions, variable resolution, cancellation,
timeouts, safe reporting, engine fail-fast behavior, editor behavior, and
Runner capability gating. PostgreSQL/API and real-Chromium checks remain
explicit integration verification.
