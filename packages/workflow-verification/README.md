# TaskTwin workflow verification

`@tasktwin/workflow-verification` provides deterministic, runtime-validated
semantics for the existing workflow-schema `VerifyStep`. It is independent of
Playwright, DOM, application frameworks, Prisma and filesystem APIs.

Supported outcomes are current URL, element text, visibility, form-field
value and checkbox/radio checked state. URL comparison ignores query and
fragment and supports `origin` or `origin_and_path`. Text is normalized with
Unicode NFC, collapsed whitespace and trimming before exact or contains
comparison. Field values are exact only.

Expected values may be literals or compatible variables. Secret and file
expectations are rejected. Results contain only kind, outcome, attempt count,
duration and an optional safe boolean/state; they never contain observed or
expected values, URLs, locator content or HTML.

```powershell
pnpm --filter @tasktwin/workflow-verification lint
pnpm --filter @tasktwin/workflow-verification typecheck
pnpm --filter @tasktwin/workflow-verification test
pnpm --filter @tasktwin/workflow-verification build
```
