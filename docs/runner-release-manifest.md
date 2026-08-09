# Runner release manifest and detached signature

Every release publishes exactly three versioned files:

```text
tasktwin-runner-<version>-windows-x64.zip
tasktwin-runner-<version>-release-manifest.json
tasktwin-runner-<version>-release-signature.json
```

The strict version 1 manifest contains build-derived data only:

```json
{
  "schemaVersion": 1,
  "product": "tasktwin-runner",
  "version": "0.1.0",
  "channel": "stable",
  "sourceCommit": "0000000000000000000000000000000000000000",
  "builtAt": "2026-08-09T00:00:00.000Z",
  "compatibility": {
    "runnerProtocolVersion": 2,
    "workflowSchema": { "readable": { "min": 1, "max": 1 } },
    "localState": { "readableSchemas": [1], "writableSchema": 1 },
    "localSecretVault": {
      "readableSchemas": [1],
      "writableSchema": 1,
      "readableProtectionProfiles": [
        "local_secret_master_key_wrap_v1",
        "windows_dpapi_ng_machine_v1"
      ]
    }
  },
  "artifacts": [
    {
      "platform": "windows",
      "architecture": "x64",
      "fileName": "tasktwin-runner-0.1.0-windows-x64.zip",
      "archiveFormat": "zip",
      "sizeBytes": 1,
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  ],
  "signingKeyId": "reviewed-key-id"
}
```

The illustrative size, commit, digest and key ID above are not release values.
Strict validation rejects unexpected properties, prerelease versions on the
stable channel, non-normalized timestamps, duplicate targets, unsorted schema
lists, and filenames not derived from product/version/target.

After validation, TaskTwin serializes the manifest through its existing
canonical JSON contract. SHA-256 and the Ed25519 signature cover the same
canonical UTF-8 bytes, so pretty printing and ordinary object-key insertion
order do not change the signed meaning.

The detached signature contains only schema version, algorithm `Ed25519`, key
ID, canonical-manifest SHA-256 and base64url signature. Its key ID must equal
the manifest key ID and resolve through the verifier's pre-trusted public-key
registry. The manifest cannot add a key. The artifact SHA-256 and byte size are
calculated over the exact ZIP that is published, not its extracted files.

See [ADR-034](adr/ADR-034-signed-release-manifest.md) for the trust decision and
[Runner release packaging](runner-release-packaging.md) for archive controls.
