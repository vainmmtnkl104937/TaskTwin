-- CreateTable
CREATE TABLE "recording_workflow_conversions" (
    "id" UUID NOT NULL,
    "recording_session_id" UUID NOT NULL,
    "client_conversion_id" UUID NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "workflow_version_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "conversion_report" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_workflow_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recording_workflow_conversions_workflow_version_id_key" ON "recording_workflow_conversions"("workflow_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "recording_workflow_conversions_session_client_key" ON "recording_workflow_conversions"("recording_session_id", "client_conversion_id");

-- CreateIndex
CREATE INDEX "recording_workflow_conversions_session_created_idx" ON "recording_workflow_conversions"("recording_session_id", "created_at");

-- CreateIndex
CREATE INDEX "recording_workflow_conversions_workflow_id_idx" ON "recording_workflow_conversions"("workflow_id");

-- CreateIndex
CREATE INDEX "recording_workflow_conversions_created_by_id_created_at_idx" ON "recording_workflow_conversions"("created_by_id", "created_at");

-- AddForeignKey
ALTER TABLE "recording_workflow_conversions" ADD CONSTRAINT "recording_workflow_conversions_recording_session_id_fkey" FOREIGN KEY ("recording_session_id") REFERENCES "recording_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_workflow_conversions" ADD CONSTRAINT "recording_workflow_conversions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_workflow_conversions" ADD CONSTRAINT "recording_workflow_conversions_workflow_version_id_fkey" FOREIGN KEY ("workflow_version_id") REFERENCES "workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_workflow_conversions" ADD CONSTRAINT "recording_workflow_conversions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
