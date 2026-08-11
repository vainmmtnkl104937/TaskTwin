# Session 34: Secure Runner release acquisition

Session 34 lets an operator explicitly acquire a previously published signed
Runner release into a local verified cache. Acquisition is local and inert: it
does not invoke the updater, install software, restart the service, execute an
archive, or accept a Control Plane command.

## Trust and source policy

- The CLI accepts a product version or immutable `rr1_<manifest-sha256>` release
  reference, never an artifact URL.
- Release origins and path prefixes come only from the reviewed Local Runner
  trusted-source registry. Sources must be normalized HTTPS origins and the
  registry fails closed when empty.
- Manifest and detached-signature locations are deterministic. The artifact
  filename and identity come only from the verified strict signed manifest.
- Session 31 trusted-key, canonical digest, detached Ed25519 signature and
  artifact verification are reused unchanged. Production private keys are not
  stored or used by acquisition.

## Bounded download and cache

Manifest, signature and artifact sizes are bounded. HTTPS connections have
bounded connect, read-progress and total request deadlines. Artifact bytes are
streamed to an isolated partial file while SHA-256 is calculated.

A partial can resume only when its signed artifact identity, on-disk length,
strong ETag, `Accept-Ranges` observation, exact `206` status and exact
`Content-Range` all agree. Any ambiguous range or changed remote identity
discards the partial and restarts from byte zero. Existing partial bytes are
rehashed before append.

Promotion requires exact signed size and SHA-256, followed by the complete
Session 31 file verifier. The cache directory is then atomically renamed into
the verified namespace. Partial files never enter `runner-update` and remain
inert data.

## Local CLI

```text
runner release acquire <version-or-release-ref> [--data-root <absolute-path>]
runner release cache list [--data-root <absolute-path>]
runner release cache status [--data-root <absolute-path>]
```

Cache output contains safe release identity, version, target and verification
time only. It does not expose local paths, source URLs, ETags, signatures or
artifact hashes. Installation remains a separate, explicit Session 32 local
update operation.

## Current limitations

- Trusted release sources are deployment-reviewed static configuration; there
  is no CLI or environment override.
- The repository default trusted-source and production-key registries are
  intentionally empty and fail closed until deployment provisions them.
- Redirects, mirrors, proxies with content transformation and weak ETags are
  not supported.
- There is no discovery feed, GitHub polling, background acquisition,
  automatic install or cache eviction command.
