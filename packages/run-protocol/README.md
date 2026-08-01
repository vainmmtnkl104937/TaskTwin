# TaskTwin run protocol

`@tasktwin/run-protocol` defines the strict framework-independent contracts
for persisted workflow runs, runner claims, leases, ordered progress,
completion, cancellation and safe read metadata.

It reuses workflow-engine progress and result schemas. It contains no NestJS,
Prisma, React, Playwright, filesystem or network implementation.

Verify is a supported persisted run step when the assigned Runner advertises
`workflow_verification_v1`. Progress continues to contain status and safe
codes only. Completion and run detail may contain the strict value-free
verification result stored inside the existing `WorkflowRun.finalResult`
JSONB document; no verification table or column is required.
