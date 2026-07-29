-- CreateEnum
CREATE TYPE "recording_session_status" AS ENUM ('receiving', 'completed');

-- CreateTable
CREATE TABLE "recording_sessions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "client_session_id" UUID NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "target_origin" VARCHAR(512) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "stopped_at" TIMESTAMPTZ(3) NOT NULL,
    "event_count" INTEGER NOT NULL,
    "last_sequence" INTEGER NOT NULL,
    "privacy_summary" JSONB NOT NULL,
    "metadata_digest" CHAR(64) NOT NULL,
    "status" "recording_session_status" NOT NULL DEFAULT 'receiving',
    "received_event_count" INTEGER NOT NULL DEFAULT 0,
    "received_min_sequence" INTEGER,
    "received_max_sequence" INTEGER,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recording_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_events" (
    "id" UUID NOT NULL,
    "recording_session_id" UUID NOT NULL,
    "client_event_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "event" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_sync_batches" (
    "id" UUID NOT NULL,
    "recording_session_id" UUID NOT NULL,
    "client_batch_id" VARCHAR(128) NOT NULL,
    "first_sequence" INTEGER NOT NULL,
    "last_sequence" INTEGER NOT NULL,
    "event_count" INTEGER NOT NULL,
    "payload_digest" CHAR(64) NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_sync_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recording_sessions_client_session_id_key" ON "recording_sessions"("client_session_id");

-- CreateIndex
CREATE INDEX "recording_sessions_workspace_id_status_created_at_idx" ON "recording_sessions"("workspace_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "recording_sessions_created_by_user_id_created_at_idx" ON "recording_sessions"("created_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX "recording_sessions_status_updated_at_idx" ON "recording_sessions"("status", "updated_at");

-- CreateIndex
CREATE INDEX "recording_events_recording_session_id_created_at_idx" ON "recording_events"("recording_session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "recording_events_recording_session_id_client_event_id_key" ON "recording_events"("recording_session_id", "client_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "recording_events_recording_session_id_sequence_key" ON "recording_events"("recording_session_id", "sequence");

-- CreateIndex
CREATE INDEX "recording_sync_batches_recording_session_id_processed_at_idx" ON "recording_sync_batches"("recording_session_id", "processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "recording_sync_batches_recording_session_id_client_batch_id_key" ON "recording_sync_batches"("recording_session_id", "client_batch_id");

-- AddForeignKey
ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_events" ADD CONSTRAINT "recording_events_recording_session_id_fkey" FOREIGN KEY ("recording_session_id") REFERENCES "recording_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_sync_batches" ADD CONSTRAINT "recording_sync_batches_recording_session_id_fkey" FOREIGN KEY ("recording_session_id") REFERENCES "recording_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
