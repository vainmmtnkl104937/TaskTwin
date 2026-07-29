# Session 06: Privacy-bounded browser event capture

## Goal

Capture a deterministic, minimal browser interaction timeline for the active
recording tab without generating locators, workflows, or executable behavior.

## Included

- Strict Zod schemas for sanitized candidates, accepted events, target
  snapshots, timeline storage, flush messages, and popup summaries
- Actionable click, text-input, select, checkbox, and radio event types
- Document-level delegated capture without page-event modification
- Service-worker validation, sender verification, identity assignment, and
  monotonically increasing sequence
- 500 ms text-input debounce and flush before blur, pause, and stop
- Password and one-time-code masking with null stored values
- Session-scoped timeline storage with an explicit 1,000-event bound
- Safe popup event count and fixed latest-action summary
- A local fixture page and DOM-focused unit tests

## Event flow and authority

```text
Page event
  -> content script: allow, sanitize, validate candidate
  -> service worker: validate candidate and sender/session boundary
  -> service worker: assign sessionId, tabId, eventId, sequence
  -> chrome.storage.session: persist accepted timeline
  -> popup: event count plus fixed action category only
```

The content script cannot author accepted-event envelope fields. The service
worker accepts candidates only in `recording`, from frame zero of the bound tab
and HTTP(S) origin. Idle, paused, starting, stopping, and error states reject
events without mutating the timeline.

## Capture rules

Only trusted primary clicks on actionable elements are captured. Delegation
resolves a nested icon or span to its actionable ancestor. Selects, checkboxes,
and radios use change events only, preventing duplicate click/change
representations. Synthetic and non-primary click events are ignored.

Supported text controls debounce repeated input to one final candidate. Blur
flushes that control. Pause and stop first suspend listeners, flush all pending
input, wait for the service-worker acknowledgements, and only then change
state. Interactions while paused are not captured; resume reattaches listeners.

Password input types and password/OTP autocomplete annotations produce
`value: null` with a fixed masking reason. Hidden and file inputs are ignored.
The popup never receives an accepted event or raw value.

## Data and storage bounds

Candidate and accepted-event objects are strict and JSON-serializable. Strings
are trimmed or truncated before validation. Target snapshots include only
bounded tag/type, role, id, name, label, accessible name, placeholder, short
text preview, and approved test-ID hints. Full DOM, outerHTML, arbitrary
attributes, complete page URLs, and raw messages are not stored or logged.

The timeline is ordered, session-bound, and limited to 1,000 accepted events.
The service worker never evicts an old event or silently ignores a new one at
capacity; it persists `EVENT_LIMIT_REACHED` and capture stops. Storage failure
similarly moves the recorder to an explicit error when possible.

Starting a new recording replaces the old timeline with an empty one. Stop
preserves the completed timeline for safe popup inspection. Storage uses the
same browser-session lifetime as Session 05 state.

## Excluded and limitations

- Locator resolution or generation
- Workflow generation, editing, persistence, or execution
- Backend synchronization and local-runner communication
- Playwright, AI, policy, approval, and repair behavior
- Submit, keyboard-shortcut, contenteditable, multi-select, drag, upload,
  navigation, screenshot, or arbitrary DOM capture
- Cross-navigation content-script recovery
- Durable history across browser or extension restart

The event contract is extension-internal in this session. Converting reviewed
events into the framework-independent workflow schema is a future boundary.
