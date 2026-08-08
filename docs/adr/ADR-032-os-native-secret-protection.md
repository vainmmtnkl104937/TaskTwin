# ADR-032: Windows-native Local Secret Store protection

Status: Accepted

## Context

The Session 29 passphrase protector cannot unlock after reboot without an
operator. The Control Plane cannot receive a passphrase, master key, protected
key blob or secret value.

## Decision

The existing `LocalSecretMasterKeyProtector` and `MasterKeyLease` abstractions
gain a versioned `windows_dpapi_ng_machine_v1` protection profile. Its
versioned binding profile explicitly records
`windows_machine_and_vault_acl_v1`: DPAPI-NG uses the documented
`LOCAL=machine` rule, while the service SID ACL limits access to the local vault
file. The native plaintext payload contains a SHA-256 digest of canonical
master-key AAD followed by the random 256-bit master key. The AAD binds vault,
Workspace, Runner, revision and safe inventory digest. A wrong binding or
tampered blob fails closed.

PowerShell is invoked with a fixed local script and fixed arguments. The native
request travels over stdin; keys and blobs are never command-line arguments,
environment values or logs. The bridge calls Windows CNG DPAPI APIs directly
and clears managed byte arrays where practical. Protected metadata remains in
the local vault and is rejected by Control Plane protocol schemas.

Migration is explicit. Under the existing exclusive vault lock, TaskTwin
unwraps the passphrase-protected key from a no-echo prompt, decrypt-validates
all records, wraps the same key natively, increments revision, writes a
temporary candidate, reopens it with the native protector, validates every
record, and only then atomically replaces the old vault. Verification failure
removes the candidate and preserves the previous bytes. No plaintext backup is
created and no automatic migration occurs during service installation.

## Consequences

- The service can auto-unlock after reboot on the same Windows machine.
- Copying the protected vault to another machine does not provide a usable
  key. Logical Runner/vault substitution also fails its authenticated context.
- Machine scope does not cryptographically isolate local accounts. The
  service-SID filesystem ACL, Windows host security and full-disk encryption
  are required controls; local administrators can defeat this boundary.
- A compromised unlocked process can access plaintext in memory, and
  JavaScript cannot guarantee immediate zeroization of strings.
- macOS/Linux protectors, automatic downgrade, master-key rotation, backups and
  forensic secure deletion are not implemented.
