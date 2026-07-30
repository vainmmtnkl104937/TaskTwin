-- Session 13: workflow version lifecycle, provenance, and idempotency.
ALTER TYPE "workflow_lifecycle_status" ADD VALUE 'testing' AFTER 'draft';

ALTER TABLE "workflow_versions"
ADD COLUMN "created_from_version_id" UUID,
ADD COLUMN "client_creation_id" UUID,
ADD COLUMN "published_at" TIMESTAMPTZ(3),
ADD COLUMN "published_by_id" UUID,
ADD COLUMN "archived_at" TIMESTAMPTZ(3),
ADD COLUMN "archived_by_id" UUID;

-- Never choose a winner or archive historical data implicitly. An operator
-- must resolve invalid legacy state explicitly before applying this migration.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "workflow_versions"
        WHERE "status" = 'published'
        GROUP BY "workflow_id"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Session 13 requires at most one published version per workflow';
    END IF;
END $$;

CREATE UNIQUE INDEX "workflow_versions_workflow_id_client_creation_id_key"
ON "workflow_versions"("workflow_id", "client_creation_id");

CREATE INDEX "workflow_versions_workflow_id_status_version_idx"
ON "workflow_versions"("workflow_id", "status", "version");

CREATE INDEX "workflow_versions_created_from_version_id_idx"
ON "workflow_versions"("created_from_version_id");

CREATE INDEX "workflow_versions_published_by_id_idx"
ON "workflow_versions"("published_by_id");

CREATE INDEX "workflow_versions_archived_by_id_idx"
ON "workflow_versions"("archived_by_id");

-- Prisma does not currently express PostgreSQL partial unique indexes. This
-- database constraint is the final one-current-published-version boundary.
CREATE UNIQUE INDEX "workflow_versions_one_published_per_workflow_key"
ON "workflow_versions"("workflow_id")
WHERE "status" = 'published';

ALTER TABLE "workflow_versions"
ADD CONSTRAINT "workflow_versions_created_from_version_id_fkey"
FOREIGN KEY ("created_from_version_id")
REFERENCES "workflow_versions"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "workflow_versions"
ADD CONSTRAINT "workflow_versions_published_by_id_fkey"
FOREIGN KEY ("published_by_id")
REFERENCES "users"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "workflow_versions"
ADD CONSTRAINT "workflow_versions_archived_by_id_fkey"
FOREIGN KEY ("archived_by_id")
REFERENCES "users"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
