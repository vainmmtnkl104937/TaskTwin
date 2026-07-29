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
  sanitized candidates for approved interaction types only.
- Pure recorder contracts, state-machine, and controller modules are isolated
  from Chrome APIs and covered by unit tests.

## Storage lifecycle

Recorder state and the version 1 event timeline are stored under
`tasktwin.recorder.session.v1` and `tasktwin.recorder.timeline.v1` in
`chrome.storage.session`. This survives popup closure and Manifest V3
service-worker suspension, but is cleared when Chrome restarts or the extension
is disabled, reloaded, or updated. The next state request then creates a fresh
idle state.

Starting creates an empty timeline for the new session. Stopping preserves the
completed timeline for inspection, and the next start replaces it explicitly.
The timeline is capped at 1,000 accepted events. Reaching the cap produces an
explicit recorder error; events are never silently evicted or dropped.

Storage remains limited to trusted extension contexts. The content script does
not read Chrome storage directly. Storage failures return a safe typed error;
malformed stored state is never trusted.

## Capture boundary

The recorder supports actionable trusted primary clicks, debounced text-input
changes, single selects, checkboxes, and selected radios. Clicks on select,
checkbox, and radio controls are suppressed so their `change` event is the
single representation. Synthetic and non-primary clicks are ignored.

Text input is debounced by 500 ms and flushed on blur, pause, and stop. Password
inputs and inputs marked with `current-password`, `new-password`, or
`one-time-code` autocomplete metadata emit only a null value and fixed masking
reason. Hidden and file inputs are ignored.

Target snapshots contain only bounded allowlisted hints: normalized tag and
input type, role, id, name, associated label text, accessible name,
placeholder, short text preview, and approved test-ID attributes. The recorder
does not serialize DOM, outerHTML, arbitrary attributes, full URLs, cookies, or
tokens.

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
`apps/extension/dist`. Open `http://127.0.0.1:4176`, then exercise click, input,
select, checkbox, radio, pause, resume, and stop. Inspect
`chrome.storage.session` from the extension service worker and confirm password
and OTP text is absent. Starting on `chrome://extensions` must show a safe
unsupported-page error.

## Current limitations

Dynamic injection does not automatically survive a page reload or cross-origin
navigation. Recorder state and timeline are intentionally not retained across
browser restarts and are not synchronized to the backend or local runner.
Contenteditable controls, multi-selects, submit semantics, keyboard shortcuts,
locators, workflow generation, and execution are not implemented.
