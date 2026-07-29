# TaskTwin locator engine

`@tasktwin/locator-engine` is the framework-independent ranking boundary for
recorded browser locators. It accepts already measured observations and
returns a strict, JSON-serializable `LocatorBundle` version 1.

The package owns fixed scoring constants, dynamic-identifier heuristics,
candidate deduplication, deterministic tie-breaking, rule-based reasons, and
high/medium/low confidence. It reuses `ElementLocator` from
`@tasktwin/workflow-schema` and adds no DOM, Chrome, Playwright, API, database,
UI, or AI dependency.

The caller must determine accessible names and current-document match counts.
Only observations with `matchCount === 1` can enter a bundle. Ranking order is
score descending, strategy priority, risk count, canonical locator length, and
finally lexical canonical locator order. At most four unique fallbacks are
retained.

Base scores are test ID 90, role 82, label 76, stable ID 72, placeholder 62,
stable name 58, text 48, and CSS 30. Uniqueness adds 8; role/label semantics
add 4; short values add 2. UUID, timestamp, hash, numeric suffix,
framework/random identifier, long text, positional/deep CSS, and generated
class rules apply fixed penalties. High confidence requires a primary score of
at least 90 without severe risk and a fallback scoring at least 70. Medium
requires a non-CSS primary of at least 65 without severe risk. All other valid
bundles are low confidence.

```shell
pnpm --filter @tasktwin/locator-engine lint
pnpm --filter @tasktwin/locator-engine typecheck
pnpm --filter @tasktwin/locator-engine test
pnpm --filter @tasktwin/locator-engine build
```
