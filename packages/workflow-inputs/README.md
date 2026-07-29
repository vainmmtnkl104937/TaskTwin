# @tasktwin/workflow-inputs

Framework-independent, deterministic workflow-variable and run-input
analysis for TaskTwin.

The package validates variable references, applies an explicit
variable-to-step compatibility matrix, derives secret requirements from
workflow `ValueSource` references, and validates temporary run-input
submissions. It never accepts secret values.

Runtime file inputs contain bounded metadata only. File content, workflow
execution, run persistence, secret storage, and implicit type conversions are
outside this package.
