# Runner capabilities

`scheduled_execution_v1` means the headless Runner can execute unattended workflows. `local_secret_store_v1` is separate and means the local vault is currently unlocked, READY, backed by `LocalVaultSecretProvider`, and synchronized to the accepted Control Plane inventory.

The local-secret capability is withheld when the vault is locked, unavailable, corrupted, or synchronization fails. A scheduled workflow with secret references requires both capabilities; workflows without secrets continue to require only scheduled execution compatibility.

Capabilities are not software compatibility. Session 31 additionally requires
the last accepted Runner product/protocol/Workflow/local-state identity to be
`compatible` or `update_recommended` before any job claim or scheduled
dispatch. `update_required`, `unsupported` and incomplete legacy identities do
not receive new work even when their runtime capabilities are otherwise ready.

`runner_service_v1` means the process has verified that it is running under the
installed Windows service configuration and is not draining.
`os_native_secret_unlock_v1` additionally requires an available native
protector, successful native unwrap, valid vault binding and synchronized
inventory. Neither capability is inferred from configuration alone.

Runtime metadata distinguishes `interactive`, `unattended_process` and
`service`. `boot_resilient` requires the fully verified service/native state;
otherwise unattended execution is only `process_unattended`. A service with
failed native unlock may retain `runner_service_v1` and
`scheduled_execution_v1` for non-secret workflows while withholding both
secret capabilities.
