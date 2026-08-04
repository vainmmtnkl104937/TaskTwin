# Session 23: Deterministic locator repair proposals

## Included

Session 23 introduces `@tasktwin/workflow-locator-repair`, the
`locator_repair_proposals_v1` attended Runner capability, local bounded
candidate discovery, privacy filtering, read-only candidate tests, persisted
proposal metadata, Workspace Repair Center controls and locator-only Draft
application.

Eligibility is fail-closed. Click, Fill, Select and SetChecked require
`not_started`; read-only Verify and Extract failures may use `read_only`.
`side_effect_possible`, `unknown`, approval-gated and unsupported failures are
rejected. Semantic candidates outrank bounded CSS; dynamic identifiers are
penalized or removed; at most five candidates are uploaded.

Every proposal binds the run, source Published WorkflowVersion, failed step and
attempt, repair request, source step/locator digests, Runner and page-context
digest. Candidate tests only count and inspect actionability/state through
Playwright Locator APIs. They never invoke click, fill, select, setChecked,
submit, navigation or workflow actions.

Applying a passed candidate requires an existing Draft descended from the
source version, a matching expected revision and unchanged target locator. The
transaction replaces only that locator, validates the complete definition and
increments revision. It never modifies the source Published definition or
creates/publishes a Draft.

## Excluded and limitations

The failed run is never resumed and receives no runtime locator override. This
session excludes automatic Draft creation/publishing, locator editing during a
run, browser restart, crash resume, XPath, arbitrary JavaScript, screenshots,
DOM/HTML uploads, AI and candidate learning. Candidate tests require the same
live page context and an attended headed Runner.

## Verification

Default tests cover deterministic eligibility, ranking, privacy filtering,
candidate bounds and immutable locator patching. Database/API and real-browser
flows require PostgreSQL, an applied Session 23 migration, a paired attended
Runner and explicit fixture interaction; they are not part of the default unit
test suite.
