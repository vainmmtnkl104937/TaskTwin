# ADR-020: Explicit deterministic outcome verification

## Status

Accepted for Session 19.

## Context

An action completing without a Playwright exception does not prove that a
workflow achieved its intended outcome. TaskTwin needs explicit assertions
that can be reviewed before publication and executed locally without leaking
runtime values or browser state to the Control Plane.

## Decision

TaskTwin extends the existing version 1 `VerifyStep` with deterministic URL,
text, visibility, field-value, and checked-state rules. Shared semantic rules
live in framework-independent `@tasktwin/workflow-verification`; Playwright DOM
access remains in the Local Runner adapter. Element assertions use existing
read-only locators and require exactly one match, except that absence satisfies
a hidden assertion.

Verification uses bounded cancellable polling. It does not mutate, reload, retry
actions, repair locators, or execute workflow-provided code. Expected sources
are limited to compatible literals and runtime variables. Secrets, files, and
password-field value inspection fail closed. Safe results contain only rule
kind, outcome, attempts, timing, and bounded state labels.

Runners advertise `workflow_verification_v1`; the Control Plane rejects a
Verify workflow when the assigned Runner lacks it. Existing JSON workflow and
result columns are sufficient, so Session 19 adds no migration.

## Consequences

Published workflows can express reviewable success criteria and failed
verification stops later steps consistently with other engine failures. The
limited assertion set remains predictable and privacy-preserving, at the cost
of excluding regex, visual testing, JavaScript predicates, compound rules,
automatic generation, and locator fallback repair.
