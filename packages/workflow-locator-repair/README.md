# @tasktwin/workflow-locator-repair

Framework-independent contracts and deterministic policy for locator repair
proposals. The package never accesses a browser, DOM, database or application
framework. Browser discovery and read-only candidate tests remain inside the
Local Runner.

Candidates are bounded, ranked with `@tasktwin/locator-engine`, and accepted
only when `@tasktwin/privacy-engine` classifies their metadata as safe. A
candidate can patch only the locator of a compatible Draft step; it is never a
runtime override for the failed WorkflowRun.
