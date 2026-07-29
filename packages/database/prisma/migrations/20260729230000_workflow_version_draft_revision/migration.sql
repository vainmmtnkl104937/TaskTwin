-- Session 11: optimistic concurrency for mutable draft workflow versions.
ALTER TABLE "workflow_versions"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
