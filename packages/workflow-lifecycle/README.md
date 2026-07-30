# @tasktwin/workflow-lifecycle

Framework-independent deterministic lifecycle logic for TaskTwin workflow
versions.

The package owns the valid `draft`, `testing`, `published`, and `archived`
transitions, publish-readiness analysis, safe issue contracts, immutable draft
cloning, and counts-only lifecycle summaries. It depends only on shared
workflow contracts and workflow-input analysis.

The persisted WorkflowVersion envelope is authoritative for lifecycle state.
Transitions do not rewrite the stored definition or increment its draft
revision. A new draft clone preserves variables, steps, and step IDs, changes
only version metadata, and never mutates its source.

This package contains no React, Next.js, NestJS, Prisma, browser, Playwright,
execution, network, persistence, or AI behavior.

```powershell
pnpm --filter @tasktwin/workflow-lifecycle lint
pnpm --filter @tasktwin/workflow-lifecycle typecheck
pnpm --filter @tasktwin/workflow-lifecycle test
pnpm --filter @tasktwin/workflow-lifecycle build
```
