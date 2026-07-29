# ADR-009: Keep privacy classification deterministic and local

- Status: Accepted
- Date: 2026-07-29

## Context

Recording browser interactions can expose personal information, credentials,
financial data, identity details, and health information. Input masking based
only on `type="password"` is not sufficient: sensitive intent can also be
expressed through autocomplete tokens, labels, accessible names, placeholders,
IDs, and names. Text used to describe a target or build a locator can leak the
same information even when the event value itself is removed.

TaskTwin also needs a stable redaction contract for a future screenshot
boundary. That contract must be useful without capturing an image in this
session, and its geometry must not depend on DOM or Chrome objects.

Privacy decisions affect whether data is retained at all. They therefore must
be repeatable, reviewable, enforceable without a network connection, and
testable independently from the browser.

## Decision

Create the framework-independent `@tasktwin/privacy-engine` package. It owns
strict JSON-serializable schemas, bounded rule dictionaries, deterministic
classification, fixed explanation codes, policy selection, sanitization
results, and redaction-plan geometry. It has no Chrome, DOM, application
framework, persistence, Playwright, network, or AI dependency.

Classification consumes only an explicit metadata allowlist: element tag,
input type, autocomplete, name, ID, label text, accessible name, placeholder,
and role. It never consumes a form, complete page body, HTML, arbitrary
attributes, browser handle, or DOM node. English rules and a small explicit
Vietnamese set classify data as public, general, personal, authentication,
financial, identity, health, or unknown-sensitive. Fixed rule order and
tie-breaking make the same normalized input produce the same decision.

Every version 1 `PrivacyDecision` includes sensitivity, capture policy,
confidence, matched rule IDs, and bounded reason codes. The MVP policy matrix
is:

- Public and general data are allowed.
- Personal data are masked by default and may be allowed by the supported
  setting.
- Unknown-sensitive data are masked.
- Authentication, financial, identity, and health data are blocked.

Blocked categories cannot be weakened by settings. Masking produces a null
value. Blocking omits the value entirely. Password, OTP, token, financial,
identity, and health values are removed before timeline persistence and are
never included in logs or error objects.

The extension remains responsible for DOM access. It builds the allowlisted
privacy input, applies the pure decision to event payloads, sanitizes target
text and locator observations, and preserves safe structural identifiers.
Stable test IDs and IDs are not discarded merely because their element is
sensitive, provided the identifier itself contains no sensitive literal.

Version 1 `PrivacySettings` are validated at runtime and stored locally in the
extension. Personal data default to masking. The settings also control whether
all text controls are included in a redaction plan and whether the local
developer preview is visible. Settings cannot alter a blocked category.

Version 1 `RedactionPlan` stores viewport width and height, device pixel ratio,
generation time, and ordered solid-redaction regions. The pure engine validates
finite numbers, normalizes negative dimensions, clamps regions to the viewport,
rejects zero-area results, deterministically deduplicates or merges significant
overlaps, and enforces a hard region limit. Coordinates remain in CSS pixels;
device pixel ratio is metadata for a future image boundary.

The extension scans only supported relevant controls, ignores invisible or
zero-size elements, and obtains bounding rectangles without reading their
values. The optional fixture preview renders removable, non-interactive
overlays only in the active recording context. Preview elements are excluded
from capture metadata and never persisted.

No screenshots are captured or stored in this decision.

## Consequences

Privacy behavior is local, deterministic, explainable, and unit-testable.
Control-plane services and AI models never receive page metadata or recording
values. Event values, target descriptions, and locator identity share one
privacy boundary rather than relying on unrelated ad hoc filters.

Rule-based classification is deliberately incomplete. It can produce false
positives and cannot identify every regional identifier, natural-language
secret, custom widget, iframe, closed shadow root, canvas value, or sensitive
free-form page fragment. The bounded English and Vietnamese dictionaries are a
safety foundation, not a compliance claim.

Rectangle planning does not guarantee pixel-perfect coverage for transformed
elements, browser zoom, nested scrolling contexts, or future screenshot
capture. Device pixel conversion and image redaction belong to the future
capture boundary. OCR, AI classification, face recognition, screenshot
capture or upload, encryption-key management, backend synchronization,
workflow generation, and Playwright execution remain out of scope.
