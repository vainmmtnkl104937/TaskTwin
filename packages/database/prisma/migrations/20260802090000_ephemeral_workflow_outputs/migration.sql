CREATE TYPE "workflow_run_output_type" AS ENUM ('STRING', 'BOOLEAN');
CREATE TYPE "workflow_run_output_status" AS ENUM ('NOT_PRODUCED', 'PRODUCED');

CREATE TABLE "workflow_run_outputs" (
    "id" UUID NOT NULL,
    "workflow_run_id" UUID NOT NULL,
    "output_name" VARCHAR(128) NOT NULL,
    "output_type" "workflow_run_output_type" NOT NULL,
    "producer_step_id" VARCHAR(256) NOT NULL,
    "producer_step_index" INTEGER NOT NULL,
    "status" "workflow_run_output_status" NOT NULL DEFAULT 'NOT_PRODUCED',
    "produced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflow_run_outputs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workflow_run_outputs_producer_step_index_check" CHECK ("producer_step_index" >= 0),
    CONSTRAINT "workflow_run_outputs_produced_at_check" CHECK (
      ("status" = 'PRODUCED' AND "produced_at" IS NOT NULL) OR
      ("status" = 'NOT_PRODUCED' AND "produced_at" IS NULL)
    )
);

CREATE UNIQUE INDEX "workflow_run_outputs_run_id_output_name_key"
ON "workflow_run_outputs"("workflow_run_id", "output_name");
CREATE UNIQUE INDEX "workflow_run_outputs_run_id_producer_step_id_key"
ON "workflow_run_outputs"("workflow_run_id", "producer_step_id");
CREATE UNIQUE INDEX "workflow_run_outputs_run_id_producer_step_index_key"
ON "workflow_run_outputs"("workflow_run_id", "producer_step_index");
CREATE INDEX "workflow_run_outputs_run_id_status_idx"
ON "workflow_run_outputs"("workflow_run_id", "status");

ALTER TABLE "workflow_run_outputs"
ADD CONSTRAINT "workflow_run_outputs_workflow_run_id_fkey"
FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
