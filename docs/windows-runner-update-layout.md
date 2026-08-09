# Windows Runner managed installation layout

Session 32 uses versioned software directories because Windows SCM and WinSW
bind absolute executable/runtime paths. It does not replace a running
executable in place and does not require a symlink.

For a paired Runner device, the controlled software root is:

```text
%ProgramData%\TaskTwin\RunnerInstallations\<runner-device-id>\
  active-release.v1.json
  update-journal.v1.json
  locks\update\
  runtime\
    startup-status.v1.json
    logs\
  staging\
    ru1_<update-sha256>\...
  releases\
    <semver>-<first-32-manifest-digest-chars>\
      installed-release.v1.json
      proof\
        release-manifest.json
        release-signature.json
        tasktwin-runner-<semver>-windows-x64.zip
      payload\
        tasktwin-runner-<semver>-windows-x64\...
      activation\
        TaskTwinRunner_<device-id-without-hyphens>.exe
        TaskTwinRunner_<device-id-without-hyphens>.xml
        runner-service.v1.json
        runner-service-activation.v1.json
```

`rr1_<manifest-sha256>` identifies a verified release and
`ru1_<deterministic-sha256>` identifies an update. Directory resolution is
contained under the device installation root; controlled recursive deletion
rejects the root itself, parents, links and paths outside `staging` or
`releases`.

## Proof and installed records

`installed-release.v1.json` is a strict index containing product/version,
source commit, target, signing key ID, manifest digest, exact artifact
descriptor and installation timestamp. It is not sufficient proof on its own.
Every load for apply, rollback or recovery revalidates the retained manifest,
signature and ZIP against the compiled trusted keys, validates the extracted
tree and compares extracted files to archive bytes.

`active-release.v1.json` contains a monotonically increasing generation,
current and previous release IDs, activation ID and activation timestamp. It
contains no path. Its atomic replacement is the controller's selected-release
record.

`update-journal.v1.json` contains safe release/update IDs, versions, manifest
and artifact digests, state, revision, timestamps and an optional stable error
code. It contains no credentials, paths, vault data, protected key metadata,
run IDs or leases. Each transition is strict and atomically replaced.

## Activation switching

Each release receives an adjacent, checksum-verified WinSW executable and XML
configuration sharing the service basename. The XML binds that release's
packaged `runtime\node.exe` and `dist\index.js` plus strict activation metadata.
After staging reaches `ready_to_switch`, the controller:

1. verifies SCM is bound to the source activation;
2. stops and waits for the service;
3. persists `switching`;
4. changes SCM `binPath` to the target WinSW executable and verifies the read
   back value;
5. atomically advances the active-release record;
6. starts and health-checks the target.

SCM and the JSON record cannot form one filesystem transaction. The journal
therefore records the intent before rebind. A crash or mismatch between SCM,
active record and activation proof is resolved by `runner update recover` only
when observations are unambiguous; otherwise it fails to manual recovery.

## Separation from mutable state

The selected Runner data root remains separate:

```text
<data-root>\.tasktwin\
  runner-credential.json
  runner-encryption-key.json
  local-secret-vault.v1.json
  protected local master-key metadata
  runner instance lock and other local state
```

Those names illustrate the boundary, not content to copy. The update staging
allowlist rejects `.tasktwin`, `.env`, vault, credential, private-key, service
instance, browser-profile, test/fixture and source files. Update does not move,
rewrite, migrate or back up mutable state.

## Windows ACL boundary

The managed installation root is not protected by POSIX mode bits. Before and
after acquiring the update lease, the updater applies and validates a
SID-based Windows DACL using the fixed System32 PowerShell path. SYSTEM and
Built-in Administrators receive full control. The deterministic per-service
SID receives read/execute access to immutable releases and Modify only under
the runtime status/log tree.

Immutable release, proof, payload and activation entries must be owned by
SYSTEM, have inheritance disabled and contain exactly the allowlisted ACEs.
The active pointer, journal, lock entries and runtime descendants are expected
to be replaced dynamically; they may inherit only the same effective parent
ACEs and may not add principals, deny rules or reparse points. ACL validation
runs again before activation load, SCM rebind/start and managed `service-run`.
Node, `dist/index.js`, build identity and activation files are additionally
rehash-checked before SCM mutation. Windows system tools are invoked only by
absolute System32 paths, never through current-directory executable search.

## Retention and bootstrap

After successful verification the default retention decision keeps two
verified releases: current and previous. Nonterminal journal participants are
always protected, and all releases are kept in
`manual_recovery_required`. Cleanup considers release IDs first and performs
deletion only through contained application paths.

The controller does not infer a managed base from an existing SCM executable
or mutable package/config version. Installations created before this layout
lack `active-release.v1.json`, retained proof and a per-release activation;
they require a separately reviewed out-of-band bootstrap. A missing managed
base fails closed instead of claiming automatic rollback is possible.
