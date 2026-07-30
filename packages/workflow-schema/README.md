# TaskTwin Workflow Schema

`@tasktwin/workflow-schema` is the framework-independent runtime contract for
TaskTwin workflow definitions. Zod schemas are the source of truth and the
exported TypeScript types are inferred from those schemas.

Workflow definition version 1 is strict, JSON-serializable data. Its `steps`
array is the authoritative execution order. The package contains no UI,
database, Chrome, DOM, Playwright, or AI behavior.

## Workflow steps

Every workflow step contains a non-empty `id`, a discriminating `type`, and a
non-empty `name`. Version 1 supports:

- `navigate`
- `click`
- `fill`
- `select`
- `setChecked`
- `wait`
- `extract`
- `verify`
- `approval`

`setChecked` represents a deterministic resulting checkbox or radio state:

```json
{
  "id": "enableWelcomeEmail",
  "type": "setChecked",
  "name": "Enable Send welcome email",
  "locator": {
    "kind": "label",
    "value": "Send welcome email",
    "exact": true
  },
  "checked": true
}
```

It is not modeled as a blind click. A future runner must resolve the locator
and set the control to the requested boolean state.

Adding `setChecked` is an additive version 1 change. Existing version 1
workflows remain valid. The original Session 02 fixture is retained at
`fixtures/valid-workflow.v1.json`, while
`fixtures/valid-set-checked-workflow.v1.json` covers both boolean states.

## Values and secrets

Value sources are discriminated as literal values, workflow-variable
references, or secret references. A secret source stores only a valid
`secretName`; plaintext secret values are rejected as unexpected properties.

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
