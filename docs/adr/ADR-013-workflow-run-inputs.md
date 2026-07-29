# ADR-013: Derived workflow run inputs and secret requirements

## Status

Accepted for Session 12.

## Context

A workflow definition can use literal values, declared variables, and secret
references. Structural Zod validation alone cannot prove that a variable
exists, that its type is suitable for a step property, or that a secret
reference is a safe alias. The editor also needs a deterministic preview of
runtime inputs without creating a workflow run or collecting secrets.

## Decision

TaskTwin uses `packages/workflow-inputs` as the framework-independent semantic
boundary for workflow inputs. It:

- walks ValueSources in `steps` execution order;
- validates variable references and an explicit compatibility matrix;
- reports unused declarations as warnings;
- derives deduplicated secret requirements from secret references;
- validates safe secret aliases without accepting secret values;
- prepares a run-input form plan from declarations; and
- validates temporary, JSON-serializable runtime submissions.

Variable rename is an immutable editor-core operation that changes the
declaration and every matching reference in one returned definition. Removal
is rejected while usages remain.

Runtime preview values stay in React component memory and disappear when the
preview closes. They are not persisted or sent to the API. File input exposes
only temporary size and media-type metadata; no file content or upload is
supported.

The API runs structural workflow validation and semantic workflow-input
analysis before persistence. Blocking issues are returned as bounded,
structured errors without raw values.

## Consequences

- Declaration, reference, and runtime input concerns have one deterministic
  source of truth.
- Secret requirements cannot drift from workflow steps.
- Existing schema-version-1 workflows without variables remain valid.
- Date and file declarations can be previewed, but no current workflow step
  consumes them without an explicit conversion rule.
- Workflow execution, run persistence, file upload, and secret resolution
  remain separate future decisions.
