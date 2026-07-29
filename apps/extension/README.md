# TaskTwin Recorder extension

The TaskTwin Chrome extension records a small, privacy-bounded interaction
timeline. Its Manifest V3 service worker is the only component authorized to
change recorder state or assign accepted-event identity and ordering.

## Components

- The popup requests current state, renders valid controls and safe timeline
  summaries, and sends typed commands. It never changes stored state directly
  or renders raw input values.
- The service worker validates commands, loads and persists state, chooses the
  active tab when starting, coordinates the content script, validates event
  candidates, and assigns the authoritative event envelope and sequence.
- The dynamically injected content script validates state notifications and
  uses document-level delegated listeners while recording. It emits strict,
  sanitized candidates for approved interaction types only. Its DOM adapter
  derives labels and accessible names, checks exact match counts, and creates a
  bounded CSS fallback before pure locator ranking. A separate privacy adapter
  creates allowlisted classification input and visible-control redaction
  geometry without reading field values.
- Pure recorder contracts, state-machine, and controller modules are isolated
  from Chrome APIs and covered by unit tests.

## Storage lifecycle

Recorder state and the version 3 event timeline are stored under
`tasktwin.recorder.session.v1` and `tasktwin.recorder.timeline.v3` in
`chrome.storage.session`. This survives popup closure and Manifest V3
service-worker suspension, but is cleared when Chrome restarts or the extension
is disabled, reloaded, or updated. The next state request then creates a fresh
idle state.

Starting creates an empty timeline for the new session. Stopping preserves the
completed timeline for inspection, and the next start replaces it explicitly.
The timeline is capped at 1,000 accepted events. Reaching the cap produces an
explicit recorder error; events are never silently evicted or dropped.

Recorder state and timeline storage remain limited to trusted extension
contexts. The content script reads only the separate local privacy settings.
Storage failures return a safe typed error; malformed stored state, timeline,
or settings are never trusted.

Privacy settings use a separate runtime-validated version 1 contract in
`chrome.storage.local` under `tasktwin.privacy.settings.v1`. They persist across
recorder sessions and extension service-worker suspension. Missing or invalid
settings resolve to defaults: personal data are masked, all-text-control
redaction is disabled, and the developer preview is hidden. Settings cannot
change the block policy for authentication, financial, identity, or health
data.

The timeline loader can read the Session 07 `timeline.v2` and Session 06
`timeline.v1` keys so the popup can summarize an existing browser-session
recording after an extension update. New recordings always write v3. Legacy
events are not upgraded because their current-document privacy decision was
not recorded.

## Semantic locators

Every new event contains `LocatorBundle` version 1. The extension proposes
allowlisted test IDs, role plus accessible name, associated label, stable ID,
placeholder, stable name, short visible text, and bounded CSS observations.
The pure locator engine retains only candidates that match exactly one current
document element, then applies fixed scoring and tie-breaking rules. Semantic
locators rank above CSS; dynamic identifiers, generated classes, deep or
positional CSS, and long text reduce score. Confidence is deterministic, not
AI-generated.

The adapter reads no input value while generating locators. Before ranking,
privacy checks reject sensitive literal text from labels, accessible names,
placeholders, and visible text. A safe stable test ID or ID remains eligible on
a sensitive field, but an identifier containing sensitive data does not. The
adapter stores no DOM node, HTML, arbitrary attribute, complete DOM path,
cookie, URL, password, or OTP. Accessible-name extraction currently covers
common native controls, explicit allowlisted ARIA roles, `aria-label`,
`aria-labelledby`, associated labels, and short button/link text.

## Capture boundary

The recorder supports actionable trusted primary clicks, debounced text-input
changes, single selects, checkboxes, and selected radios. Clicks on select,
checkbox, and radio controls are suppressed so their `change` event is the
single representation. Synthetic and non-primary clicks are ignored.

Text input is debounced by 500 ms and flushed on blur, pause, and stop. Before
an event candidate is sent, deterministic privacy rules classify bounded
allowlisted metadata and select one of three policies:

- `allow` retains a value only after the existing length bound.
- `mask` stores a null value.
- `block` omits the value entirely.

Personal data are masked by default. Authentication, financial, identity, and
health values are always blocked; settings cannot weaken these categories.
Unknown-sensitive data are masked. Password, one-time-code, token, financial,
identity, and health values do not enter the timeline, logs, popup, or error
objects. Hidden and file inputs remain ignored.

Target snapshots contain only bounded allowlisted hints: normalized tag and
input type, role, ID, name, associated label text, accessible name,
placeholder, short text preview, and approved test-ID attributes. Textual
hints are sanitized before persistence so a user-entered email, phone number,
token, card-like number, or similar sensitive literal cannot become target or
locator identity. The recorder does not serialize DOM, outerHTML, arbitrary
attributes, full URLs, cookies, or tokens.

## Privacy classification and redaction plan

`@tasktwin/privacy-engine` applies local fixed rules to element tag, input type,
autocomplete, name, ID, label, accessible name, placeholder, and role. It
classifies public, general, personal, authentication, financial, identity,
health, and unknown-sensitive metadata and returns a version 1 decision with
policy, confidence, matched-rule IDs, and fixed explanations. Page data are
never sent to a backend or AI model.

For future screenshot work, the content script can collect bounding rectangles
from visible supported controls that require masking or blocking. It does not
read their values or scan the complete page body. The pure engine normalizes
the rectangles, clamps them to the CSS-pixel viewport, rejects zero-area
regions, deterministically merges or deduplicates significant overlaps, orders
the result, and enforces a hard maximum. Device pixel ratio is plan metadata
for a future image boundary; the extension does not capture or persist an
image.

The local fixture supports an optional redaction preview. Its overlays are
limited to the active recording context, removable without a page reload,
excluded from capture metadata, and styled with `pointer-events: none`. The
preview does not change input values and is not persisted.

## Permissions

The extension requests only:

- `activeTab` for temporary access after the user opens the extension action.
- `scripting` to inject the packaged content script into that selected tab.
- `storage` to use session-scoped extension storage.

There are no host permissions, optional host permissions, static content
scripts, or `<all_urls>` access. Recording can start only on HTTP and HTTPS
pages. Internal browser pages and other URL schemes are rejected.

## Development

```shell
pnpm --filter @tasktwin/extension lint
pnpm --filter @tasktwin/extension typecheck
pnpm --filter @tasktwin/extension test
pnpm --filter @tasktwin/extension build
pnpm --filter @tasktwin/extension fixture:serve
```

The build produces `index.html`, `service-worker.js`, `content-script.js`, the
popup assets, and `manifest.json` in `apps/extension/dist`.

To verify manually, build the extension, run the fixture server, enable
Developer mode at `chrome://extensions`, choose **Load unpacked**, and select
`apps/extension/dist`. Open `http://127.0.0.1:4176`, then exercise the ordinary,
personal, password, OTP, financial, identity, and health fixture fields before
testing pause, resume, and stop. Inspect both `chrome.storage.session` and
`chrome.storage.local` from the extension service worker.

Confirm ordinary bounded text is allowed, personal values are null by default,
and blocked fixture values are absent from storage, logs, popup text, and
errors. Confirm safe test-ID locators remain and sensitive visible text does
not become locator identity. Enable the developer preview, verify that regions
are bounded and overlays do not block interaction, then disable it and confirm
that all overlays are removed. Starting on `chrome://extensions` must still
show a safe unsupported-page error.

There is no settings UI in this session. From the extension service-worker
DevTools console, enable the local preview with:

```js
await chrome.storage.local.set({
  'tasktwin.privacy.settings.v1': {
    schemaVersion: 1,
    personalDataPolicy: 'mask',
    redactAllTextInputs: false,
    showRedactionPreview: true,
  },
});
```

Pause and resume, or start a new recording, to reload settings. To disable the
preview, store the same validated object with `showRedactionPreview: false`;
pause clears existing overlays and resume applies the updated setting. Do not
use real sensitive values during manual testing.

## Durable recording archive

Active state and the active timeline remain in `chrome.storage.session`.
Stopping first flushes pending input and validates the complete current
timeline. Only then can the service worker build a `RecordingArtifact` and
persist it in `chrome.storage.local`. A successful stop also creates a local
`pending` outbox entry; recorder success is not returned before both records
are durable.

From service-worker DevTools, inspect the versioned archive and outbox:

```js
await chrome.storage.local.get([
  'tasktwin.recordings.archive.v1',
  'tasktwin.recordings.outbox.v1',
]);
```

The initial limits are 20 retained artifacts, 4 MiB per serialized artifact,
20 non-synced outbox entries, and 8 MiB for the serialized archive document.
TaskTwin returns a fixed safe error rather than evicting or overwriting an
unsynced artifact. Exact finalization retry is idempotent.

Session 09 includes only a transport interface and mock tests. It does not
store an access token, choose a workspace, call the API in production, or run a
background retry scheduler.

## Current limitations

Dynamic injection does not automatically survive a page reload or cross-origin
navigation. Active recorder state and timeline are not retained across a full
browser restart; successfully finalized artifacts are retained locally. They
are not uploaded automatically or synchronized to the local runner.
Contenteditable controls, multi-selects, submit semantics, keyboard shortcuts,
cross-origin iframes, closed shadow DOM, canvas, full accessibility-tree
computation, locator replay, workflow generation, and execution are not
implemented. Privacy rules cover bounded English and Vietnamese patterns, not
complete global PII detection. Redaction geometry does not yet cover arbitrary
custom widgets, free-form page text, transformed elements, nested scrolling
contexts, or screenshot pixel conversion. There is no screenshot capture,
OCR, AI classification, production backend artifact transport, archive
management UI, or compliance certification.
