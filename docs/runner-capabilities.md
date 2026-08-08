# Runner capabilities

`scheduled_execution_v1` means the headless Runner can execute unattended workflows. `local_secret_store_v1` is separate and means the local vault is currently unlocked, READY, backed by `LocalVaultSecretProvider`, and synchronized to the accepted Control Plane inventory.

The local-secret capability is withheld when the vault is locked, unavailable, corrupted, or synchronization fails. A scheduled workflow with secret references requires both capabilities; workflows without secrets continue to require only scheduled execution compatibility.
