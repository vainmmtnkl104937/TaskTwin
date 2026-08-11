# `@tasktwin/runner-acquisition`

Framework-independent contracts and deterministic decisions for acquiring a
trusted TaskTwin Runner release. The package owns trusted HTTPS source policy,
bounded limits, reference binding, resume validation, state transitions and
safe cache summaries.

It performs no network, filesystem, crypto, process, archive or installation
operation. Applications must fetch metadata from a configured trusted source,
reuse `@tasktwin/runner-release` verification, stream the selected signed
artifact into an isolated partial file and atomically promote it only after
exact size and SHA-256 verification.

Resume is deliberately conservative. It requires a strong ETag, advertised
byte ranges and an exact `206 Content-Range`. Missing or ambiguous identity
causes a full restart, never an append. Downloaded ZIP files remain inert cache
data; acquisition never invokes `@tasktwin/runner-update`.
