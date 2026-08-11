# `@tasktwin/runner-rollout`

Framework-independent contracts and deterministic decisions for TaskTwin's
trusted Runner release catalog, compliance model, and explicit staged rollout.

The package performs no I/O. It has no knowledge of NestJS, Prisma, React,
filesystems, operating systems, download locations, updater commands, or
service managers. Actual software identity is distinct from declarative desired
release metadata, and compatibility is always evaluated from explicit protocol
and schema contracts rather than from a "latest version" comparison.

Stage progression is explicit. Convergence and rollback are observations of
authenticated Runner heartbeat identity; neither outcome emits an update or
rollback instruction.
