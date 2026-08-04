CREATE TYPE "workflow_locator_repair_proposal_status" AS ENUM (
  'OPEN', 'READY', 'APPLIED', 'EXPIRED', 'INVALIDATED'
);

CREATE TYPE "workflow_locator_repair_candidate_test_status" AS ENUM (
  'NOT_REQUESTED', 'PENDING', 'PASSED', 'NOT_FOUND', 'NOT_UNIQUE',
  'NOT_ACTIONABLE', 'INCOMPATIBLE_ELEMENT', 'STALE_PAGE_CONTEXT',
  'CANCELLED', 'ERROR'
);

CREATE TABLE "workflow_locator_repair_proposals" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "workflow_run_id" UUID NOT NULL,
  "source_workflow_version_id" UUID NOT NULL,
  "runner_device_id" UUID NOT NULL,
  "workflow_repair_request_id" UUID NOT NULL,
  "step_id" VARCHAR(256) NOT NULL,
  "step_index" INTEGER NOT NULL,
  "failed_attempt_number" INTEGER NOT NULL,
  "client_proposal_id" UUID NOT NULL,
  "request_digest" CHAR(64) NOT NULL,
  "source_step_digest" CHAR(64) NOT NULL,
  "source_locator_digest" CHAR(64) NOT NULL,
  "page_context_digest" CHAR(64) NOT NULL,
  "status" "workflow_locator_repair_proposal_status" NOT NULL DEFAULT 'OPEN',
  "selected_candidate_id" UUID,
  "applied_draft_version_id" UUID,
  "applied_draft_revision" INTEGER,
  "applied_by_user_id" UUID,
  "client_apply_id" UUID,
  "apply_digest" CHAR(64),
  "applied_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "workflow_locator_repair_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_locator_repair_proposals_step_index_check" CHECK ("step_index" >= 0),
  CONSTRAINT "workflow_locator_repair_proposals_attempt_check" CHECK ("failed_attempt_number" BETWEEN 1 AND 3),
  CONSTRAINT "workflow_locator_repair_proposals_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "workflow_locator_repair_proposals_application_check" CHECK (
    ("status" <> 'APPLIED' AND "applied_draft_version_id" IS NULL AND "applied_draft_revision" IS NULL AND "applied_by_user_id" IS NULL AND "client_apply_id" IS NULL AND "apply_digest" IS NULL AND "applied_at" IS NULL)
    OR
    ("status" = 'APPLIED' AND "selected_candidate_id" IS NOT NULL AND "applied_draft_version_id" IS NOT NULL AND "applied_draft_revision" IS NOT NULL AND "applied_by_user_id" IS NOT NULL AND "client_apply_id" IS NOT NULL AND "apply_digest" IS NOT NULL AND "applied_at" IS NOT NULL)
  )
);

CREATE TABLE "workflow_locator_repair_candidates" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "client_candidate_id" UUID NOT NULL,
  "locator" JSONB NOT NULL,
  "locator_digest" CHAR(64) NOT NULL,
  "rank" INTEGER NOT NULL,
  "strategy" VARCHAR(32) NOT NULL,
  "confidence" VARCHAR(16) NOT NULL,
  "score" INTEGER NOT NULL,
  "element_kind" VARCHAR(32) NOT NULL,
  "reason_codes" JSONB NOT NULL,
  "evidence_codes" JSONB NOT NULL,
  "privacy_classification" VARCHAR(32) NOT NULL,
  "privacy_rule_ids" JSONB NOT NULL,
  "test_status" "workflow_locator_repair_candidate_test_status" NOT NULL DEFAULT 'NOT_REQUESTED',
  "client_test_request_id" UUID,
  "test_request_digest" CHAR(64),
  "test_requested_by_user_id" UUID,
  "test_requested_at" TIMESTAMPTZ(3),
  "client_test_result_id" UUID,
  "test_result_digest" CHAR(64),
  "test_observations" JSONB,
  "tested_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "workflow_locator_repair_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_locator_repair_candidates_rank_check" CHECK ("rank" BETWEEN 1 AND 5),
  CONSTRAINT "workflow_locator_repair_candidates_score_check" CHECK ("score" BETWEEN 0 AND 100),
  CONSTRAINT "workflow_locator_repair_candidates_test_request_check" CHECK (
    ("test_status" = 'NOT_REQUESTED' AND "client_test_request_id" IS NULL AND "test_request_digest" IS NULL AND "test_requested_by_user_id" IS NULL AND "test_requested_at" IS NULL)
    OR
    ("test_status" <> 'NOT_REQUESTED' AND "client_test_request_id" IS NOT NULL AND "test_request_digest" IS NOT NULL AND "test_requested_by_user_id" IS NOT NULL AND "test_requested_at" IS NOT NULL)
  ),
  CONSTRAINT "workflow_locator_repair_candidates_test_result_check" CHECK (
    ("test_status" IN ('NOT_REQUESTED', 'PENDING') AND "client_test_result_id" IS NULL AND "test_result_digest" IS NULL AND "test_observations" IS NULL AND "tested_at" IS NULL)
    OR
    ("test_status" NOT IN ('NOT_REQUESTED', 'PENDING') AND "client_test_result_id" IS NOT NULL AND "test_result_digest" IS NOT NULL AND "test_observations" IS NOT NULL AND "tested_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "workflow_locator_repair_proposals_repair_request_id_key" ON "workflow_locator_repair_proposals"("workflow_repair_request_id");
CREATE UNIQUE INDEX "workflow_locator_repair_proposals_selected_candidate_id_key" ON "workflow_locator_repair_proposals"("selected_candidate_id");
CREATE UNIQUE INDEX "workflow_locator_repair_proposals_run_client_key" ON "workflow_locator_repair_proposals"("workflow_run_id", "client_proposal_id");
CREATE UNIQUE INDEX "workflow_locator_repair_proposals_run_step_attempt_key" ON "workflow_locator_repair_proposals"("workflow_run_id", "step_id", "failed_attempt_number");
CREATE UNIQUE INDEX "workflow_locator_repair_proposals_workspace_apply_key" ON "workflow_locator_repair_proposals"("workspace_id", "client_apply_id");
CREATE INDEX "workflow_locator_repair_proposals_workspace_status_idx" ON "workflow_locator_repair_proposals"("workspace_id", "status", "created_at");
CREATE INDEX "workflow_locator_repair_proposals_runner_status_idx" ON "workflow_locator_repair_proposals"("runner_device_id", "status");
CREATE INDEX "workflow_locator_repair_proposals_source_version_idx" ON "workflow_locator_repair_proposals"("source_workflow_version_id");
CREATE INDEX "workflow_locator_repair_proposals_draft_version_idx" ON "workflow_locator_repair_proposals"("applied_draft_version_id");

CREATE UNIQUE INDEX "workflow_locator_repair_candidates_test_request_id_key" ON "workflow_locator_repair_candidates"("client_test_request_id");
CREATE UNIQUE INDEX "workflow_locator_repair_candidates_test_result_id_key" ON "workflow_locator_repair_candidates"("client_test_result_id");
CREATE UNIQUE INDEX "workflow_locator_repair_candidates_proposal_client_key" ON "workflow_locator_repair_candidates"("proposal_id", "client_candidate_id");
CREATE UNIQUE INDEX "workflow_locator_repair_candidates_proposal_locator_key" ON "workflow_locator_repair_candidates"("proposal_id", "locator_digest");
CREATE UNIQUE INDEX "workflow_locator_repair_candidates_proposal_rank_key" ON "workflow_locator_repair_candidates"("proposal_id", "rank");
CREATE UNIQUE INDEX "workflow_locator_repair_candidates_one_pending_test_key" ON "workflow_locator_repair_candidates"("proposal_id") WHERE "test_status" = 'PENDING';
CREATE INDEX "workflow_locator_repair_candidates_proposal_test_status_idx" ON "workflow_locator_repair_candidates"("proposal_id", "test_status");
CREATE INDEX "workflow_locator_repair_candidates_test_requester_idx" ON "workflow_locator_repair_candidates"("test_requested_by_user_id");

ALTER TABLE "workflow_locator_repair_proposals" ADD CONSTRAINT "workflow_locator_repair_proposals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_locator_repair_proposals" ADD CONSTRAINT "workflow_locator_repair_proposals_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_locator_repair_proposals" ADD CONSTRAINT "workflow_locator_repair_proposals_source_version_id_fkey" FOREIGN KEY ("source_workflow_version_id") REFERENCES "workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_locator_repair_proposals" ADD CONSTRAINT "workflow_locator_repair_proposals_runner_device_id_fkey" FOREIGN KEY ("runner_device_id") REFERENCES "runner_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_locator_repair_proposals" ADD CONSTRAINT "workflow_locator_repair_proposals_repair_request_id_fkey" FOREIGN KEY ("workflow_repair_request_id") REFERENCES "workflow_repair_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_locator_repair_proposals" ADD CONSTRAINT "workflow_locator_repair_proposals_draft_version_id_fkey" FOREIGN KEY ("applied_draft_version_id") REFERENCES "workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_locator_repair_proposals" ADD CONSTRAINT "workflow_locator_repair_proposals_applied_by_user_id_fkey" FOREIGN KEY ("applied_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_locator_repair_candidates" ADD CONSTRAINT "workflow_locator_repair_candidates_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "workflow_locator_repair_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_locator_repair_candidates" ADD CONSTRAINT "workflow_locator_repair_candidates_test_requested_by_user_id_fkey" FOREIGN KEY ("test_requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_locator_repair_proposals" ADD CONSTRAINT "workflow_locator_repair_proposals_selected_candidate_id_fkey" FOREIGN KEY ("selected_candidate_id") REFERENCES "workflow_locator_repair_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
