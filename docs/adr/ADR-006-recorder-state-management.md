# ADR-006: Coordinate recorder state through the service worker and session storage

- Status: Accepted
- Date: 2026-07-29

## Context

TaskTwin Recorder now needs reliable communication between its popup, Manifest
V3 service worker, and a page content script. Extension service workers are
ephemeral, so global variables cannot be the only state source. Messages and
stored objects cross runtime boundaries where TypeScript types no longer
protect the application.

The recorder must restore state when the popup reopens without creating
long-term recording history or requesting broad access to websites. This
session coordinates state only and must not capture browser events or page
content.

## Decision

The service worker is the authoritative recorder coordinator. The popup sends
commands but never applies state transitions or writes storage. The content
script receives state notifications but cannot issue recorder commands.

Recorder state version 1 and all messages use strict Zod schemas. The state
machine is deterministic and framework-independent. Public commands produce
explicit transitions:

- start: idle to starting
- pause: recording to paused
- resume: paused to recording
- stop: recording or paused to stopping
- reset: error to idle

Internal completion transitions move starting to recording and stopping to
idle. Invalid transitions return `INVALID_TRANSITION` without writing storage.
Successful transitions are persisted before dependent side effects continue.
Interrupted starting or stopping states are restored as a safe error.

State is stored in `chrome.storage.session`. It survives popup closure and
service-worker suspension but is cleared by a browser restart, extension
reload, update, or disable. This matches the absence of long-term recording
persistence and keeps state off disk. The content script retains the default
untrusted-context restriction and cannot read this storage directly.

The manifest requests only `activeTab`, `scripting`, and `storage`.
`activeTab` provides temporary access after the user invokes the extension;
the service worker uses `scripting` to inject a packaged content script into
that selected tab. There are no host permissions, optional host permissions,
static content scripts, or all-URL access.

## Consequences

Each command reads validated state from storage, so service-worker restarts do
not erase the current browser-session state. A small in-memory promise queue
serializes concurrent commands, but it is not a persistence mechanism.

The active tab ID, window ID, and HTTP/HTTPS origin are bound at start. Full
page URLs are not stored. Unsupported schemes are rejected and settle in an
error state that the user can reset.

Zod becomes a direct runtime dependency of the extension, while Vitest and
Chrome typings support development. Build configuration produces a module
service worker and a self-contained classic content script.

Session-scoped storage deliberately resets on browser restart. Dynamic content
injection does not persist through navigation, and no event capture, workflow
generation, backend synchronization, authentication, or local-runner
communication is implemented.
