# TaskTwin Privacy Engine

`@tasktwin/privacy-engine` is the framework-independent, deterministic privacy
boundary used by TaskTwin's local browser recorder. Classification accepts
only bounded allowlisted metadata, and geometry accepts JSON rectangle
candidates. The local sanitization function may receive one transient captured
value solely to return an allowed bounded value, `null`, or a block result; it
does not include that value in decisions, reasons, errors, or logs.

The package provides:

- Runtime-validated privacy inputs, settings, decisions and redaction plans.
- Bounded English rules and a small explicit Vietnamese rule set.
- Fixed `allow`, `mask` and `block` policies.
- Sensitive-literal filtering for persisted target and locator text.
- Rectangle normalization, viewport clamping, overlap merging and stable
  ordering.

Authentication, financial, identity and health policies are always `block`.
Personal data defaults to `mask`, and unknown-sensitive data is always masked.
No setting can weaken a blocked category.

The package has no DOM, Chrome, UI, database, backend, Playwright or AI
dependency. It does not receive full forms, page bodies, screenshots or
browser handles.

## Commands

```sh
pnpm --filter @tasktwin/privacy-engine lint
pnpm --filter @tasktwin/privacy-engine typecheck
pnpm --filter @tasktwin/privacy-engine test
pnpm --filter @tasktwin/privacy-engine build
```
