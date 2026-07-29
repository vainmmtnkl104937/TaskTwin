# TaskTwin Recorder extension

The TaskTwin Chrome extension coordinates a recording session without capturing
browser interaction events yet. Its Manifest V3 service worker is the only
component authorized to change recorder state.

## Components

- The popup requests current state, renders valid controls, and sends typed
  commands. It never changes stored state directly.
- The service worker validates commands, loads and persists state, chooses the
  active tab when starting, and coordinates the content script.
- The dynamically injected content script validates state notifications and
  acknowledges them. It does not attach browser interaction listeners or read
  page content.
- Pure recorder contracts, state-machine, and controller modules are isolated
  from Chrome APIs and covered by unit tests.

## Storage lifecycle

Recorder state version 1 is stored under
`tasktwin.recorder.session.v1` in `chrome.storage.session`. This survives popup
closure and Manifest V3 service-worker suspension, but is cleared when Chrome
restarts or the extension is disabled, reloaded, or updated. The next state
request then creates a fresh idle state.

Storage remains limited to trusted extension contexts. The content script does
not read Chrome storage directly. Storage failures return a safe typed error;
malformed stored state is never trusted.

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
```

The build produces `index.html`, `service-worker.js`, `content-script.js`, the
popup assets, and `manifest.json` in `apps/extension/dist`.

To verify manually, enable Developer mode at `chrome://extensions`, choose
**Load unpacked**, and select `apps/extension/dist`. Start on a normal HTTP or
HTTPS page, close and reopen the popup to verify state restoration, then test
pause, resume, and stop. Starting on `chrome://extensions` must show a safe
unsupported-page error.

## Current limitations

The content script records no click, input, change, submit, keyboard, page,
form, screenshot, or locator data. Dynamic injection does not automatically
survive a page reload or cross-origin navigation. Recorder state is intentionally
not retained across browser restarts and is not synchronized to the backend or
local runner.
