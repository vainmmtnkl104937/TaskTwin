# Session 12: Workflow variables and run-input foundation

## Included

Session 12 adds:

- optional variable labels and `date` and `file` declaration types;
- framework-independent variable, secret, and runtime-input analysis;
- deterministic cross-reference and type-compatibility validation;
- immutable add, edit, rename, remove, usage, and ValueSource operations;
- a web Variables panel with usage navigation and protected removal;
- compatible literal, variable, and secret-reference selection;
- a component-memory-only Run Inputs Preview;
- safe API validation issues before Draft persistence; and
- unit plus opt-in workflow-editor integration coverage.

Variable declarations remain inside `WorkflowDefinition`. No Prisma model or
migration is required.

## Literal, variable, and secret sources

A literal contains a bounded JSON scalar directly in the workflow. A variable
references a declaration by identifier. A secret source stores only a safe
alias; secret values are neither workflow data nor run-input submissions.
Secret requirements are derived from step references rather than maintained as
a second mutable list.

Rename returns a new workflow definition with the declaration and every
matching reference changed together. Rename collisions, referenced removal,
unknown references, and incompatible type changes are rejected without
mutating the original definition.

## Compatibility

- Navigate URL, text assertions, and URL assertions accept string variables.
- Fill accepts string variables and safe secret aliases.
- Select accepts string or number variables.
- Value assertions accept matching string, number, or boolean variables.
- No boolean-to-text, date-to-text, or file conversion is implicit.

## Temporary preview

The editor derives controls from declarations and validates a temporary
submission using `packages/workflow-inputs`. Preview state is held only by the
mounted component. Closing the dialog clears it. The preview does not call the
API, browser storage, workflow persistence, or execution.

File controls retain only temporary size and media type. They do not read or
upload content. Secret aliases are listed separately, and no secret-value
field exists.

## Excluded

Session 12 does not add WorkflowRun persistence, history, execution,
Playwright, Local Runner behavior, secret storage, password-manager
integration, file upload, expressions, templates, formulas, AI suggestions,
publishing, or workflow-version creation.
