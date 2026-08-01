# @tasktwin/workflow-editor-core

Framework-independent draft workflow editing operations for TaskTwin.

The package treats `WorkflowDefinition.steps` array order as the sole execution
order. Its operations are immutable and never generate random identifiers;
callers must provide IDs for inserted steps.

React, React Flow, Next.js, NestJS, Prisma, browser APIs, persistence and UI
state do not belong in this package.

Session 12 adds immutable variable operations. Rename updates the declaration
and every ValueSource reference atomically. Removal is rejected while usages
remain, and a type change is rejected when an existing usage is incompatible.
Operations return typed business-result unions and do not generate names or
identifiers.

Session 19 adds immutable helpers for explicit URL and element Verify steps.
Element verification copies an existing step locator into a read-only Verify
contract; the editor never repairs or rewrites that locator. Complete Draft
validation also applies deterministic verification semantic analysis before a
save can proceed.
