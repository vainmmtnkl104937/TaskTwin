ALTER TYPE "workflow_approval_risk_level" ADD VALUE IF NOT EXISTS 'CRITICAL';

CREATE TYPE "workspace_execution_policy_status" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "workspace_execution_policy_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "workspace_execution_policy_status" NOT NULL DEFAULT 'ACTIVE',
  "schema_version" INTEGER NOT NULL,
  "definition" JSONB NOT NULL,
  "digest" CHAR(64) NOT NULL,
  "client_version_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "activated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_execution_policy_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_policy_versions_workspace_revision_key"
ON "workspace_execution_policy_versions"("workspace_id", "revision");
CREATE UNIQUE INDEX "workspace_policy_versions_workspace_client_key"
ON "workspace_execution_policy_versions"("workspace_id", "client_version_id");
CREATE UNIQUE INDEX "workspace_policy_versions_one_active_key"
ON "workspace_execution_policy_versions"("workspace_id") WHERE "status" = 'ACTIVE';
CREATE INDEX "workspace_policy_versions_workspace_status_idx"
ON "workspace_execution_policy_versions"("workspace_id", "status", "revision");
CREATE INDEX "workspace_policy_versions_workspace_digest_idx"
ON "workspace_execution_policy_versions"("workspace_id", "digest");
CREATE INDEX "workspace_policy_versions_creator_idx"
ON "workspace_execution_policy_versions"("created_by_user_id");

ALTER TABLE "workspace_execution_policy_versions"
ADD CONSTRAINT "workspace_execution_policy_versions_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_execution_policy_versions"
ADD CONSTRAINT "workspace_execution_policy_versions_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "workspaces" w
    WHERE NOT EXISTS (
      SELECT 1 FROM "organization_members" m
      WHERE m."organization_id" = w."organization_id"
    )
  ) THEN
    RAISE EXCEPTION 'Every Workspace requires an organization member before execution-policy bootstrap';
  END IF;
END $$;

INSERT INTO "workspace_execution_policy_versions" (
  "workspace_id", "revision", "status", "schema_version", "definition",
  "digest", "client_version_id", "created_by_user_id"
)
SELECT
  w."id",
  1,
  'ACTIVE',
  1,
  '{"schemaVersion":1,"network":{"mode":"workflow_declared_origins","allowedOrigins":[],"blockedOrigins":[],"allowLoopbackHttp":true},"unknownActionRisk":"medium","approval":{"threshold":"high_or_above","criticalActionBehavior":"deny"},"rules":[]}'::jsonb,
  '0fa5fb21b4954de3fa15d94c37e5cc4ca4be80d1da4b72782623fc30a588381c',
  '00000000-0000-4000-8000-000000000024'::uuid,
  member."user_id"
FROM "workspaces" w
CROSS JOIN LATERAL (
  SELECT m."user_id"
  FROM "organization_members" m
  WHERE m."organization_id" = w."organization_id"
  ORDER BY
    CASE m."role"
      WHEN 'OWNER' THEN 0
      WHEN 'ADMIN' THEN 1
      WHEN 'MEMBER' THEN 2
      ELSE 3
    END,
    m."created_at" ASC,
    m."user_id" ASC
  LIMIT 1
) member;

ALTER TABLE "workflow_runs"
ADD COLUMN "policy_version_id" UUID,
ADD COLUMN "policy_digest" CHAR(64),
ADD COLUMN "policy_evaluation" JSONB;

CREATE INDEX "workflow_runs_policy_version_id_created_at_idx"
ON "workflow_runs"("policy_version_id", "created_at");

ALTER TABLE "workflow_runs"
ADD CONSTRAINT "workflow_runs_policy_version_id_fkey"
FOREIGN KEY ("policy_version_id") REFERENCES "workspace_execution_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
