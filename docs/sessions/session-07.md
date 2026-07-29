# Session 07: Deterministic semantic locator engine

## Goal

Transform each captured DOM target into a stable, understandable, unique,
ranked locator bundle suitable as input to later review and replay work,
without generating workflow steps or executing a browser.

## Included

- Framework-independent `@tasktwin/locator-engine`
- Version 1 strict `LocatorBundle`, candidate, observation, reason, source, and
  confidence contracts
- Fixed scoring, dynamic-value heuristics, deduplication, tie-breaking, and
  high/medium/low confidence
- Backward-compatible workflow locator support for allowlisted test-ID
  attributes and placeholder locators
- Extension DOM adapter for common roles, accessible names, labels, exact
  current-document match counts, and bounded CSS
- Required locator bundle on new event/timeline schema version 2
- Explicit read compatibility with Session 06 timeline version 1
- Extended deterministic fixture and unit/integration tests

## Locator flow and authority

```text
Actionable DOM target
  -> extension DOM adapter: bounded observations + exact match counts
  -> locator engine: validate, score, deduplicate, rank, explain, confidence
  -> content script event candidate: strict LocatorBundle v1
  -> service worker: validate candidate and sender/session boundary again
  -> service worker: assign event envelope and persist timeline v2
```

The service worker remains the sole timeline owner. The content script cannot
choose session ID, tab ID, event ID, sequence, origin, or recorded timestamp.
Malformed locator data is rejected before persistence.

## Priority, scoring, and confidence

Base strategy scores are test ID 90, role 82, label 76, stable ID 72,
placeholder 62, stable name 58, visible text 48, and CSS 30. Exact uniqueness
adds 8, role/label semantics add 4, and a short value adds 2. Fixed penalties
apply to dynamic identifiers, long text, positional selectors, generated
classes, and deep CSS. No candidate with zero or multiple matches is retained.

Ties resolve by score, strategy priority, risk count, canonical locator length,
then lexical canonical locator value. The result is stable for the same target
and page state. High confidence requires a strong risk-free semantic primary
and a good fallback; medium requires a suitable non-CSS primary; CSS-only,
positional, or otherwise weaker bundles are low.

## DOM adapter boundary

The adapter supports only four test-ID attributes: `data-testid`, `data-test`,
`data-cy`, and `data-qa`. It handles common native roles and a bounded explicit
ARIA-role allowlist. Accessible names use `aria-label`, `aria-labelledby`,
associated labels, input alternative text, and short button/link text.
Labels resolve through native label associations, covering `label[for]` and
nested labels.

Stable ID and name observations use exact CSS attribute selectors. Placeholder
and visible text are normalized and bounded. CSS generation prefers a short
semantic segment and parent-child context, with positional matching only as a
last bounded fallback. XPath is never generated.

## Stability and privacy

Deterministic heuristics detect UUIDs, timestamps, long hashes, numeric
suffixes, common framework patterns, random mixed tokens, and generated class
names. These values are penalized and explanations remain visible in the
bundle; they are never silently described as stable.

Locator generation never reads an input value. It stores no password, OTP,
DOM node, function, browser handle, `outerHTML`, `innerHTML`, arbitrary
attribute, complete DOM path, page content, cookie, token, or complete URL.
Text locators are restricted to short actionable button/link text and likely
sensitive strings are rejected. Existing Session 06 masking, debounce, flush,
capacity, popup summary, origin binding, and monotonic sequence behavior are
preserved.

## Schema compatibility

`ElementLocator` gains a placeholder member and an optional allowlisted
test-ID attribute. Existing workflow JSON remains valid, so workflow
definition schema version 1 is unchanged.

Recording candidates and accepted events now require `schemaVersion: 2` and a
validated locator bundle. New timelines use storage key
`tasktwin.recorder.timeline.v2`. The loader can read a legacy v1 key for popup
summary display, but new writes never omit locator data and legacy events are
not silently upgraded.

## Excluded and limitations

- Playwright and any locator replay or resolution engine
- Workflow-step generation, editing, repair, execution, or production updates
- Backend synchronization or database persistence
- AI/LLM ranking, screenshots, computer vision, or XPath
- Cross-origin iframes, closed shadow DOM, canvas, and scoped parent locators
- Complete accessibility-tree name computation
- User-editable locator UI

Dynamic DOM changes after capture can invalidate a locator. Confidence
describes current-page evidence, not a guarantee across future deployments.
