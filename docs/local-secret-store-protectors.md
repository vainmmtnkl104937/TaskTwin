# Local Secret Store protectors

The vault supports two strict master-key protection profiles:

- passphrase: scrypt plus AES-256-GCM, unlocked through a local no-echo prompt;
- Windows native: DPAPI-NG machine protection plus vault-context
  authentication and service-SID file ACLs.

Inspect or migrate locally:

```text
runner secrets protector status
runner secrets protector migrate --to os-native
```

Migration never accepts the passphrase on argv and never runs implicitly. It
keeps the same random master key, increments the vault revision, verifies a
temporary candidate by native reopen and decrypt-validation, then atomically
replaces the old vault. Failure before replacement leaves the old vault valid.

Neither profile provides reveal/export commands, forensic deletion, backup,
key rotation or protection against a compromised unlocked Runner. Native blobs,
vault paths and key material remain local and are invalid Control Plane input.
