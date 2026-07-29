# @tasktwin/workflow-editor-core

Framework-independent draft workflow editing operations for TaskTwin.

The package treats `WorkflowDefinition.steps` array order as the sole execution
order. Its operations are immutable and never generate random identifiers;
callers must provide IDs for inserted steps.

React, React Flow, Next.js, NestJS, Prisma, browser APIs, persistence and UI
state do not belong in this package.
