# ADR-007: Capture sanitized event candidates into a service-worker timeline

- Status: Accepted
- Date: 2026-07-29

## Context

TaskTwin needs a minimal browser interaction record that later sessions can
review and translate into workflows. Page scripts and extension content
scripts are not authoritative trust boundaries. Incoming messages and captured
DOM-derived data exist at runtime after TypeScript types have disappeared.

The recorder must preserve event order across popup closure and service-worker
suspension, avoid duplicate browser representations, retain final debounced
input, and prevent sensitive or unbounded page data from reaching storage or
the popup.

## Decision

The service worker owns the authoritative timeline. A content script uses
document-level event delegation and emits strict Zod-validated candidates.
The worker validates every candidate again, accepts it only while the recorder
is `recording`, and verifies the top-level sender tab and origin against the
session binding. It assigns `sessionId`, `tabId`, UUID `eventId`, and contiguous
`sequence`; candidates cannot supply those fields.

Accepted interaction categories are:

- trusted primary actionable clicks;
- debounced text-input changes;
- single-select changes;
- checkbox changes; and
- selected-radio changes.

Click candidates for select, checkbox, and radio controls are suppressed in
favor of their change representation. Synthetic and non-primary clicks are
ignored. Text input is debounced and pending values are flushed before blur,
pause, and stop. The pause/stop command waits for accepted flush messages
before committing the state transition.

The target snapshot is a strict bounded allowlist. It contains small semantic
hints and approved test-ID attributes, never full DOM, `outerHTML`, arbitrary
attributes, or a complete page URL. All strings have schema limits.
Password and password-autocomplete values and one-time codes are represented
only by `value: null` plus a fixed masking reason. Hidden and file inputs are
ignored.

The version 1 timeline is stored in `chrome.storage.session` beside recorder
state and is capped at 1,000 events. It is replaced explicitly on start and
retained after stop. If the limit or persistence boundary fails, the service
worker persists an error and stops capture rather than silently discarding an
event. The popup receives only event count and a fixed latest action category.

The extension continues to use only `activeTab`, `scripting`, and `storage`,
with no host permissions or `<all_urls>`.

## Consequences

The timeline is deterministic and ordered for one tab, origin, and recording
session. Runtime schemas protect both content-script and service-worker
boundaries, while storage supports worker suspension and popup reopening.

Session-scoped storage intentionally disappears on browser restart, extension
reload, update, or disable. Dynamic injection does not survive navigation.
This decision does not create locators, workflow steps, backend synchronization,
Playwright execution, policy evaluation, contenteditable capture, multi-select
capture, or arbitrary page inspection.
