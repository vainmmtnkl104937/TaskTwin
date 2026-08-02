# Session 20: Ephemeral workflow outputs

## Included

Session 20 adds deterministic Extract steps for element text, form/select
values, checked state, and safe URL origin or origin-and-path values. A later
Fill, Select, or Verify step can consume a compatible output only after its
producer.

Runtime output values live only in the Local Runner's per-execution memory.
The Workflow Engine clears them on every terminal path. Progress, completion,
API responses, logs, and PostgreSQL contain only output name, type, producer,
status, and safe timestamps.

The Workflow Editor can add URL or locator-backed Extract steps, inspect
producers and consumers, rename an output atomically, and remove only unused
producers. Locators remain read-only.

## Compatibility

The existing `outputName` Extract contract remains canonical. Retention
defaults to `ephemeral`, preserving the Session 02 text-extraction fixture.
The legacy attribute source remains parseable for stored compatibility but is
blocked by extraction analysis because attribute extraction is outside this
session.

## Excluded

Arrays, transformations, loops, branches, output-based navigation, HTML,
cookies, browser storage, network responses, files, regex, custom JavaScript,
AI extraction, retries, and returning output values to the Control Plane are
excluded.
