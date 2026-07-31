# TaskTwin run protocol

`@tasktwin/run-protocol` defines the strict framework-independent contracts
for persisted workflow runs, runner claims, leases, ordered progress,
completion, cancellation and safe read metadata.

It reuses workflow-engine progress and result schemas. It contains no NestJS,
Prisma, React, Playwright, filesystem or network implementation.
