# Session 08: Deterministic privacy classification and redaction plans

## Goal

Classify potentially sensitive browser-control metadata, apply a deterministic
allow, mask, or block policy before recording persistence, and create a
validated viewport redaction plan for future screenshot work without capturing
or storing an image.

## Included

- Framework-independent `@tasktwin/privacy-engine`
- Strict version 1 privacy input, decision, settings, and redaction-plan
  contracts
- Public, general, personal, authentication, financial, identity, health, and
  unknown-sensitive classifications
- Fixed English rules and a bounded explicit Vietnamese rule set
- Deterministic confidence, matched-rule IDs, and explanations
- Safe policy resolution with non-weakenable blocked categories
- Value, target-snapshot, and locator-text sanitization
- Runtime-validated settings stored in `chrome.storage.local`
- Extension DOM adapter for visible supported controls and bounded rectangles
- Rectangle normalization, viewport clamping, overlap merging,
  deduplication, ordering, and a hard region limit
- Optional non-interactive redaction preview on the local fixture
- Privacy fixture cases and automated regression coverage

## Package and browser boundaries

```text
Supported DOM control
  -> extension: allowlisted bounded metadata
  -> privacy engine: classify + resolve policy + explain
  -> extension: sanitize value, target, and locator observations
  -> service worker: validate candidate + sender/session boundary
  -> service worker: assign event envelope and sequence
  -> extension session storage: sanitized timeline only

Visible supported controls
  -> extension: metadata + bounding rectangles, never field values
  -> privacy engine: normalize + clamp + merge + validate
  -> optional fixture-only overlay preview
```

`@tasktwin/privacy-engine` has no DOM, Chrome, Next.js, NestJS, Prisma,
Playwright, backend, or AI dependency. It accepts and returns only strict
JSON-serializable data. DOM queries, visibility checks, accessible metadata,
bounding rectangles, Chrome storage, and preview elements stay in the
extension.

The service worker remains the recorder authority. Session 08 does not allow a
content script to choose authoritative session IDs, tab IDs, event IDs,
sequence numbers, origins, or timestamps.

## Data minimization and classification

The classifier may inspect only:

- Tag name
- Input type
- Autocomplete
- Name and ID
- Associated label text
- Accessible name
- Placeholder
- Role

Strings and matched-rule arrays are bounded. Rules are normalized and applied
in a fixed order. Decisions use fixed IDs and reasons and never echo raw field
values. No complete form, page body, page HTML, arbitrary attribute collection,
URL, cookie, token, DOM node, or browser handle enters the engine.

Authentication rules cover password controls, current/new password
autocomplete tokens, one-time-code, password labels, and OTP labels. Personal
rules cover email, phone, address, full name, and date of birth. Financial
rules cover card numbers, CVV/CVC, bank accounts, and routing information.
Identity rules cover passport, national or citizen ID, tax ID, and appropriate
student-ID metadata. Health rules cover a bounded set of common medical
metadata. Unknown secret or token-like intent is classified as
unknown-sensitive. Examples in English and a small explicit Vietnamese set are
covered by tests.

This is deterministic classification, not inference by an LLM. The same
normalized metadata and settings produce the same policy, confidence, matched
rules, and reasons.

## Policy matrix

| Sensitivity         | Default policy | Setting may weaken it                |
| ------------------- | -------------- | ------------------------------------ |
| `public`            | `allow`        | No                                   |
| `general`           | `allow`        | No                                   |
| `personal`          | `mask`         | Only to the supported `allow` policy |
| `authentication`    | `block`        | No                                   |
| `financial`         | `block`        | No                                   |
| `identity`          | `block`        | No                                   |
| `health`            | `block`        | No                                   |
| `unknown-sensitive` | `mask`         | No                                   |

An allowed value is length-bounded before persistence. A masked value becomes
null. A blocked value is omitted rather than represented as a string.
Authentication, financial, identity, and health values therefore cannot enter
the timeline even if a setting object is malformed or tries to weaken policy.
Token-like and OTP values are likewise never retained.

## Settings

`PrivacySettings` version 1 contains:

- `personalDataPolicy`: `allow` or `mask`, defaulting to `mask`
- `redactAllTextInputs`: whether otherwise allowed text controls also receive a
  redaction region
- `showRedactionPreview`: whether the local developer overlay is rendered

The settings object is runtime validated and stored in `chrome.storage.local`
so it survives the session-scoped recorder state. Missing or invalid data
falls back to safe defaults. The policy resolver, rather than the storage
object, enforces the immutable block rules.

## Event, target, and locator sanitization

Privacy metadata accompanies relevant interactions. Event payloads use their
resolved policy so a masked or blocked payload cannot accidentally carry a
plaintext value. Sanitization happens before a candidate can reach timeline
persistence. Error messages and logs use fixed descriptions and do not include
raw message payloads or values.

Target `textPreview`, label, accessible name, placeholder, ID, name, and test-ID
values pass through bounded sensitive-literal checks. Text containing an
email address, phone number, token, card-like number, or similar secret is not
retained. Structural tag/type/role data remain available.

Locator generation continues to avoid input values. Sensitive label,
accessible-name, placeholder, and visible-text observations are rejected
before ranking and checked again before persistence. A safe unique test ID or
stable ID remains eligible even when it identifies a sensitive field; an
identifier that itself contains sensitive data does not.

Session 06 debounce and flush rules and Session 07 unique-locator rules are
preserved. The service worker still checks recording state, sender tab, frame,
origin, and timeline capacity before assigning monotonic sequence.

## Redaction geometry and preview

A `RedactionPlan` version 1 contains a positive finite viewport width and
height, a validated device pixel ratio, an ISO generation timestamp, and an
ordered bounded collection of solid regions. Each region contains an ID,
finite rectangle coordinates, sensitivity, fixed reasons, and the `solid`
mode.

Input rectangles are normalized and clamped to viewport bounds. Plan creation
fails explicitly when clipping leaves a zero-area region.
Substantially overlapping or duplicate areas are merged deterministically.
Reasons are deduplicated and ordered, stronger sensitivity wins when merged,
and the final regions use stable positional ordering. The maximum-region
limit fails explicitly rather than silently dropping protection.

Rectangle coordinates are CSS pixels. Device pixel ratio is recorded so a
future screenshot boundary can translate them to device pixels; Session 08
does not perform that translation or capture an image.

The extension scans only explicitly supported form controls and sensitive
fixture elements. It ignores hidden, file, invisible, and zero-size controls
and never reads values while constructing geometry. The optional fixture
preview:

- Is limited to the active recording context
- Uses `pointer-events: none`
- Does not change input values
- Can be removed without reloading
- Is excluded from target and locator metadata
- Is never stored in the timeline or plan

## Schema compatibility

Privacy-aware candidates, accepted events, and timelines use schema version 3
and the `tasktwin.recorder.timeline.v3` session-storage key. Existing recorder
state remains version 1 and authoritative. The loader retains read-only summary
compatibility with Session 07 timeline v2 and Session 06 timeline v1. New
recordings write only v3. Old events and locator bundles are not silently
repaired, upgraded, or assigned inferred privacy metadata.

## Verification

Default tests exercise classification, policy invariants, sanitization,
geometry, settings restoration, preview lifecycle, event ordering, and safe
pause/stop flushes without requiring interactive Chrome.

Manual verification uses only fake fixture values. Extension session storage,
local settings, popup output, service-worker logs, and error output must be
searched to confirm that password, OTP, token, financial, identity, and health
fixtures do not appear. Chrome-only checks must be reported as unverified when
an interactive browser is unavailable.

## Excluded and limitations

- Screenshot capture, image persistence, upload, or backend synchronization
- OCR, AI classification, computer vision, or face recognition
- Free-form whole-page scanning or complete PII detection
- PostgreSQL artifact storage or encryption-key management
- Workflow generation, replay, repair, or Playwright execution
- Production compliance certification
- Complete coverage of regional identity, financial, and health terminology
- Cross-origin iframes, closed shadow roots, canvas, and arbitrary custom
  controls
- Guaranteed pixel-perfect redaction across transforms, zoom, nested scrolling,
  or future screenshot implementations

The privacy engine is a conservative deterministic safety boundary, not a
claim that every sensitive value can be recognized.
