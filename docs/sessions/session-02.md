# Session 02: Workflow domain model

## Goal

Define the framework-independent, versioned workflow contract shared by future
TaskTwin recorders, control-plane APIs, workflow editors, and local runners.

## Included

- `@tasktwin/workflow-schema`
- Zod runtime validation and inferred TypeScript types
- Workflow definition version 1
- Workflow lifecycle, run, and run-step statuses
- Workflow variables and scalar value sources
- Secret references without secret values
- Test ID, role, label, text, and CSS locator contracts
- Navigate, click, fill, select, wait, extract, verify, and approval steps
- Workflow assertion contracts
- Reusable valid workflow JSON fixture
- Validation tests for valid and invalid domain data

## Deterministic workflow definitions

A workflow is plain JSON data. It contains no functions, class instances,
`Date` objects, framework objects, or executable code. The `steps` array is the
authoritative execution order. Each step has an ID, type, name, and a strict
set of properties for its discriminator.

This representation makes a workflow reviewable and portable without
implementing an execution engine.

## Runtime validation

Workflow data will eventually enter the system through browser, network, file,
editor, and persistence boundaries. TypeScript types do not exist at runtime,
so every boundary must be able to parse unknown input before trusting it.

Zod is the runtime source of truth. Exported TypeScript types are inferred from
the schemas to reduce contract drift.

## Discriminated unions

Steps use `type` as their discriminator. Locators, value sources, assertions,
and extraction sources use `kind`. A discriminator selects one exact variant,
which lets runtime validation reject unsupported variants and lets TypeScript
narrow to variant-specific fields.

## Versioning

`schemaVersion: 1` identifies the shape and semantics of the workflow contract.
The positive `version` field identifies a revision of a particular
`workflowId`. Future breaking changes require another schema version instead of
silently changing version 1.

The schema does not enforce immutability across records. A later application or
persistence boundary must prevent published versions from being modified.

## Secret safety

A secret value source contains only:

```json
{
  "kind": "secret",
  "secretName": "checkoutAccessCode"
}
```

Unexpected fields, including a secret `value`, are rejected. The schema cannot
detect a secret that a caller incorrectly embeds in an ordinary literal, so
future recorders and editors must also prevent secret capture.

## Excluded

- Database and Prisma models
- API endpoints and workflow CRUD
- Authentication
- Browser event recording
- UI and React Flow
- Locator resolution
- Playwright execution
- Workflow and policy engines
- Human approval execution
- AI integration and workflow repair

## Current limitations

- Variable, secret, and extract-output references are not resolved.
- Value-source types are not checked against individual step semantics.
- Locator syntax is structurally validated but not resolved against a page.
- Assertions are contracts only and are not evaluated.
- Approval steps and statuses do not implement an approval process.
- The schema does not determine whether a workflow is safe or executable.

## Validation

Session 02 is accepted when package-specific and repository-wide lint,
typecheck, test, build, and formatting commands pass.
