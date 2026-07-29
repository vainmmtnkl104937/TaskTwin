# Session 05: Recorder state and extension coordination

## Goal

Establish deterministic recorder state and validated communication across the
popup, Manifest V3 service worker, content script, and Chrome session storage
without capturing browser interaction events.

## Included

- Strict JSON-serializable recording-state version 1
- Idle, starting, recording, paused, stopping, and error statuses
- Explicit start, pause, resume, stop, and reset transitions
- Runtime-validated recorder commands, notifications, responses, and content
  acknowledgements
- Session-scoped Chrome storage as the authoritative state source
- Synchronous service-worker listener registration
- Serialized command handling and active-tab/origin binding
- Dynamic, idempotent content-script injection
- State-driven popup controls and popup-reopen restoration
- Safe handling of unsupported browser pages and storage/content failures
- Unit tests that require no manual Chrome interaction

## Responsibilities

The popup is a view and command sender. It requests current state whenever it
opens, enables only actions valid for that state, and validates every response.
Its starting and stopping labels are pending presentation only; the popup
never writes or independently transitions authoritative state.

The service worker validates command input, reloads state from storage, applies
the pure state machine, persists every successful transition, and coordinates
the selected tab. Event listeners are registered synchronously at module top
level so Chrome can restore them when the worker starts.

The content script validates `recorder/state-changed`, maintains only a small
isolated-world active flag, and returns a typed acknowledgement. It registers
no page interaction listeners and does not inspect the DOM or forms.

## State and transition behavior

Start persists `starting`, resolves the current active tab, rejects unsupported
schemes, injects the content script, then persists `recording` with one tab,
window, and origin. Only HTTP and HTTPS origins are accepted. Page paths,
queries, and fragments are discarded.

Pause and resume preserve the session binding. Stop persists `stopping`, then
persists a clean `idle` state. Operation errors persist an `error` state, and
reset is the explicit transition back to idle. Invalid transitions return a
typed error and perform no write.

If the service worker was interrupted after persisting starting or stopping,
the next command restores that transient state to a safe error instead of
silently completing an operation.

## Storage and browser lifecycle

`chrome.storage.session` stores one versioned state object. Closing the popup
does not clear it, and service-worker suspension does not make it unavailable.
Browser restart, extension reload, update, or disable clears the area, so the
next popup open initializes idle. This behavior is intentional because
long-term recording history is out of scope.

Storage reads are runtime-validated. Read, write, or malformed-state failures
produce `STORAGE_FAILURE`; raw storage errors are not shown or logged.

## Permissions and unsupported pages

The manifest declares only `activeTab`, `scripting`, and `storage`.
`activeTab` is temporary and activated by the user's extension action.
`scripting` injects only the packaged `content-script.js`; `storage` supports
session state. There are no host permissions, static content scripts, optional
host permissions, or `<all_urls>`.

Chrome, Edge, extension, about, view-source, file, and other non-HTTP(S) pages
are unsupported. Start settles in a safe error state and never remains stuck
in starting.

## Excluded and limitations

- Click, input, select, change, submit, and keyboard recording
- DOM, form-value, page-content, cookie, token, or password inspection
- Locator generation, event timeline, screenshots, and workflow generation
- Backend sync, extension authentication, local-runner communication, and AI
- Static or persistent content-script registration
- State persistence across browser restarts

Reloading or navigating the selected page removes a dynamically injected
content script. A later command then reports content-script unavailability;
automatic navigation recovery belongs to a later recorder session.
