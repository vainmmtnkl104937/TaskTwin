-- Session 14: secure Local Runner pairing, device identity, and credentials.
CREATE TYPE "runner_pairing_status" AS ENUM (
    'PENDING',
    'APPROVED',
    'DENIED',
    'CONSUMED',
    'EXPIRED'
);

CREATE TABLE "runner_pairing_sessions" (
    "id" UUID NOT NULL,
    "device_code_hash" CHAR(64) NOT NULL,
    "user_code_digest" CHAR(64) NOT NULL,
    "status" "runner_pairing_status" NOT NULL DEFAULT 'PENDING',
    "display_name" VARCHAR(100) NOT NULL,
    "platform" VARCHAR(16) NOT NULL,
    "architecture" VARCHAR(16) NOT NULL,
    "runner_version" VARCHAR(32) NOT NULL,
    "installation_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "poll_interval_seconds" INTEGER NOT NULL,
    "last_polled_at" TIMESTAMPTZ(3),
    "workspace_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "denied_by_id" UUID,
    "denied_at" TIMESTAMPTZ(3),
    "consumed_at" TIMESTAMPTZ(3),
    "credential_delivery_expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "runner_pairing_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "runner_devices" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "pairing_session_id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "platform" VARCHAR(16) NOT NULL,
    "architecture" VARCHAR(16) NOT NULL,
    "runner_version" VARCHAR(32) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "runner_devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "runner_credentials" (
    "id" UUID NOT NULL,
    "runner_device_id" UUID NOT NULL,
    "credential_hash" CHAR(64) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "runner_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "runner_pairing_sessions_device_code_hash_key"
ON "runner_pairing_sessions"("device_code_hash");
CREATE UNIQUE INDEX "runner_pairing_sessions_user_code_digest_key"
ON "runner_pairing_sessions"("user_code_digest");
CREATE INDEX "runner_pairing_sessions_status_expires_at_idx"
ON "runner_pairing_sessions"("status", "expires_at");
CREATE INDEX "runner_pairing_sessions_workspace_id_status_idx"
ON "runner_pairing_sessions"("workspace_id", "status");
CREATE INDEX "runner_pairing_sessions_approved_by_id_idx"
ON "runner_pairing_sessions"("approved_by_id");
CREATE INDEX "runner_pairing_sessions_denied_by_id_idx"
ON "runner_pairing_sessions"("denied_by_id");

CREATE UNIQUE INDEX "runner_devices_pairing_session_id_key"
ON "runner_devices"("pairing_session_id");
CREATE UNIQUE INDEX "runner_devices_installation_id_key"
ON "runner_devices"("installation_id");
CREATE INDEX "runner_devices_workspace_id_revoked_at_last_seen_at_idx"
ON "runner_devices"("workspace_id", "revoked_at", "last_seen_at");
CREATE INDEX "runner_devices_revoked_by_id_idx"
ON "runner_devices"("revoked_by_id");

CREATE UNIQUE INDEX "runner_credentials_runner_device_id_key"
ON "runner_credentials"("runner_device_id");
CREATE UNIQUE INDEX "runner_credentials_credential_hash_key"
ON "runner_credentials"("credential_hash");
CREATE INDEX "runner_credentials_revoked_at_last_used_at_idx"
ON "runner_credentials"("revoked_at", "last_used_at");

ALTER TABLE "runner_pairing_sessions"
ADD CONSTRAINT "runner_pairing_sessions_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "runner_pairing_sessions"
ADD CONSTRAINT "runner_pairing_sessions_approved_by_id_fkey"
FOREIGN KEY ("approved_by_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "runner_pairing_sessions"
ADD CONSTRAINT "runner_pairing_sessions_denied_by_id_fkey"
FOREIGN KEY ("denied_by_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "runner_devices"
ADD CONSTRAINT "runner_devices_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "runner_devices"
ADD CONSTRAINT "runner_devices_pairing_session_id_fkey"
FOREIGN KEY ("pairing_session_id") REFERENCES "runner_pairing_sessions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "runner_devices"
ADD CONSTRAINT "runner_devices_revoked_by_id_fkey"
FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "runner_credentials"
ADD CONSTRAINT "runner_credentials_runner_device_id_fkey"
FOREIGN KEY ("runner_device_id") REFERENCES "runner_devices"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
