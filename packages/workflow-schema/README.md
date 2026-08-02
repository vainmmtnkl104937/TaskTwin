# TaskTwin Workflow Schema

`@tasktwin/workflow-schema` is the framework-independent runtime contract for
TaskTwin workflow definitions. Zod schemas are the source of truth and the
exported TypeScript types are inferred from those schemas.

Workflow definition version 1 is strict, JSON-serializable data. Its `steps`
array is the authoritative execution order. The package contains no UI,
database, Chrome, DOM, Playwright, or AI behavior.

## Workflow steps

Every workflow step contains a non-empty `id`, a discriminating `type`, and a
non-empty `name`. Version 1 supports `navigate`, `click`, `fill`, `select`,
`setChecked`, `wait`, `extract`, `verify`, and `approval`.

`extract` supports normalized text, field/select value, checked state, and
safe URL origin or origin-and-path sources. Element sources require a locator;
URL sources forbid one. Output references use
`{ "kind": "output", "outputName": "..." }`. Producer ordering, uniqueness,
type compatibility, and Navigate restrictions are enforced by
`@tasktwin/workflow-extraction`.

`verify` supports URL origin/origin-and-path, normalized text, visible/hidden,
exact field value, and checked-state rules. A Verify step may define a bounded
`timeoutMs` from 100 through 60,000 milliseconds. Secret and file expectation
semantics are validated by `@tasktwin/workflow-verification`.

Legacy verification and extraction shapes remain structurally readable where
documented, but unsafe or unsupported semantics are blocked from save,
publish, and execution until edited.

`setChecked` represents a deterministic resulting checkbox or radio state and
is not modeled as a blind click.

## Values and secrets

Value sources are discriminated as literal values, workflow-variable
references, secret references, or ephemeral output references. A secret source
stores only a valid `secretName`; plaintext secret values are rejected as
unexpected properties. Output values are never declarations or persisted
workflow data.

The schema validates structure only. It does not resolve locators, retrieve
secrets, execute workflows, or prove that a workflow is safe or publishable.

Workflow lifecycle status supports `draft`, `testing`, `published`, and
`archived`. The persisted WorkflowVersion envelope is the authoritative
lifecycle state; lifecycle transitions do not rewrite an immutable definition.

## Commands

```sh
pnpm --filter @tasktwin/workflow-schema lint
pnpm --filter @tasktwin/workflow-schema typecheck
pnpm --filter @tasktwin/workflow-schema test
pnpm --filter @tasktwin/workflow-schema build
```

An `approval` step has a bounded non-interpolated message, deterministic risk
level, scope fixed to `next_step`, and a bounded timeout. Older definitions
receive safe defaults when parsed. Cross-step analysis in
`@tasktwin/workflow-approval` rejects an Approval Step without a following
step.
