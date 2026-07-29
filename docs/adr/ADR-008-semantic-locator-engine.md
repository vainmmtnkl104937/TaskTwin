# ADR-008: Rank semantic locators deterministically

- Status: Accepted
- Date: 2026-07-29

## Context

Recorded targets need understandable, stable replay contracts. A DOM hint is
not sufficient: the same text or attribute may match nothing or several
elements, and generated IDs can look unique while changing on every render.
Ranking must be repeatable, reviewable, privacy-bounded, and shared without
coupling domain rules to Chrome or a future execution framework.

## Decision

Create framework-independent `@tasktwin/locator-engine`. It consumes
JSON-serializable locator observations whose current-document match counts
were measured by the extension. The package owns version 1 bundle/candidate
schemas, fixed scoring constants, dynamic-value heuristics, deduplication,
ordering, fixed explanation codes, and confidence.

The extension owns DOM access: native and explicit role inference, common
accessible-name extraction, label association, match counting, and bounded CSS
generation. Every persisted locator must match exactly one current element.
The primary and at most four fallbacks are unique and sorted deterministically.

Strategy base scores are: allowlisted test ID 90, role plus accessible name 82,
associated label 76, stable ID 72, placeholder 62, stable name 58, visible
text 48, and CSS 30. Unique matching, semantic meaning, and short values add
fixed points. UUIDs, timestamps, hashes, generated numeric suffixes,
framework/random values, long text, positional or deep CSS, and generated
classes receive fixed penalties. Ties resolve by strategy priority, risk
count, canonical length, and lexical canonical value.

High confidence requires a score of at least 90, no severe dynamic or
positional risk, and a fallback scoring at least 70. Medium requires a
non-CSS primary score of at least 65 without severe risk. Remaining valid
bundles are low. No LLM participates.

`ElementLocator` remains the shared locator contract. A backward-compatible
optional test-ID attribute discriminator and a new placeholder union member
are added. Existing workflow definition version 1 JSON remains valid, so the
workflow `schemaVersion` does not change.

New extension candidates and accepted timelines use event schema version 2
because a locator bundle is now required. The service worker validates the
entire inbound bundle before persistence. The storage adapter reads the
Session 06 v1 timeline for summary compatibility but writes only v2; it does
not fabricate locators for legacy events.

## Consequences

Ranking is testable without a browser and produces the same result for the
same observations. DOM behavior stays close to the browser and future
Playwright code cannot leak into contract selection.

The accessible-name implementation is intentionally a common-control subset,
not a complete accessibility tree. CSS remains brittle and low confidence.
Cross-origin iframes, closed shadow DOM, canvas, scoped parent locators,
locator replay/repair, workflow generation, screenshots, computer vision,
XPath, backend synchronization, and production workflow updates remain out of
scope.

Locator generation reads no input values and stores no HTML, arbitrary
attributes, full page content, complete URL, or complete DOM path. All locator
strings and CSS depth/length are bounded.
