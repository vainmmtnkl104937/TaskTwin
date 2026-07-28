# ADR-003: Use a framework-independent, runtime-validated workflow schema

- Status: Accepted
- Date: 2026-07-29

## Context

Workflow definitions will cross several TaskTwin boundaries. The Chrome
extension will eventually produce workflow data, the API may receive and store
it, the web application may edit it, and the local runner may execute an
approved version.

TypeScript types alone are insufficient because they are erased at runtime.
Data received from a browser, file, network request, or stored record must be
validated before domain code can trust it. Separate runtime validators and
TypeScript interfaces could also drift apart.

## Decision

TaskTwin will define workflow contracts in the framework-independent
`@tasktwin/workflow-schema` package. Zod schemas are the runtime source of
truth, and TypeScript types are inferred from those schemas where practical.

Workflow definition version 1 uses:

- A literal `schemaVersion` of `1`
- A positive workflow revision number
- Strict JSON-serializable objects
- Ordered workflow steps
- Discriminated unions for steps, locators, value sources, assertions, and
  extraction sources
- Secret references that contain only a reference name

The package has no dependency on Next.js, NestJS, Prisma, Chrome APIs, or
Playwright.

## Consequences

Every future consumer can validate unknown input with the same contract before
using it. Discriminated unions make variant handling explicit and allow
TypeScript to narrow to the correct step, locator, value source, or assertion
shape. Strict objects reject fields that a consumer does not understand.

Schema evolution must be additive by version. Version 1 semantics must not be
silently changed after workflows have been published; a breaking shape requires
a new schema version and explicit migration behavior.

Zod becomes a small runtime dependency of the schema package. The schema
validates structure but cannot prove that locators resolve, references exist,
steps are safe, or a workflow is executable. Those responsibilities remain in
future locator, policy, engine, persistence, and application sessions.
