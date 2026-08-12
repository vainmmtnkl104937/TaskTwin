import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.trim() === '') {
  throw new Error('DATABASE_URL is required for the performance baseline.');
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
const iterations = 40;

function percentile(values, ratio) {
  const ordered = [...values].sort((left, right) => left - right);
  return (
    ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))] ??
    0
  );
}

async function measure(name, query) {
  await Promise.all(
    Array.from({ length: 8 }, () => pool.query(query.text, query.values ?? [])),
  );
  const samples = [];
  for (let offset = 0; offset < iterations; offset += 8) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(8, iterations - offset) }, async () => {
        const startedAt = performance.now();
        await pool.query(query.text, query.values ?? []);
        return performance.now() - startedAt;
      }),
    );
    samples.push(...batch);
  }
  return {
    name,
    iterations,
    medianMs: Number(percentile(samples, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...samples).toFixed(3)),
  };
}

try {
  const identity = await pool.query(`
    SELECT
      (SELECT "id" FROM "runner_devices" ORDER BY "id" LIMIT 1) AS "runnerId",
      (SELECT "id" FROM "workspaces" ORDER BY "id" LIMIT 1) AS "workspaceId"
  `);
  const runnerId =
    identity.rows[0]?.runnerId ?? '00000000-0000-0000-0000-000000000000';
  const workspaceId =
    identity.rows[0]?.workspaceId ?? '00000000-0000-0000-0000-000000000000';

  const queries = [
    [
      'runner_claim_candidate',
      {
        text: `SELECT "id" FROM "workflow_runs"
        WHERE "runner_device_id" = $1::uuid AND "status" = 'QUEUED'
        ORDER BY "created_at", "id" LIMIT 1`,
        values: [runnerId],
      },
    ],
    [
      'scheduler_due_batch',
      {
        text: `SELECT "id" FROM "workflow_schedules"
        WHERE "status" = 'ACTIVE' AND "next_occurrence_at" <= clock_timestamp()
        ORDER BY "next_occurrence_at" LIMIT 100`,
      },
    ],
    [
      'notification_outbox_due_batch',
      {
        text: `SELECT "id" FROM "notification_outbox_messages"
        WHERE ("status" = 'PENDING' AND "available_at" <= clock_timestamp())
           OR ("status" = 'PROCESSING' AND "locked_until" <= clock_timestamp())
        ORDER BY "available_at", "id" LIMIT 25`,
      },
    ],
    [
      'workspace_run_page',
      {
        text: `SELECT "id", "created_at" FROM "workflow_runs"
        WHERE "workspace_id" = $1::uuid
        ORDER BY "created_at" DESC, "id" ASC LIMIT 51`,
        values: [workspaceId],
      },
    ],
    [
      'workspace_audit_page',
      {
        text: `SELECT "id", "sequence" FROM "workspace_audit_events"
        WHERE "workspace_id" = $1::uuid
        ORDER BY "sequence", "id" LIMIT 51`,
        values: [workspaceId],
      },
    ],
  ];
  const results = [];
  for (const [name, query] of queries) results.push(await measure(name, query));
  console.log(JSON.stringify({ schemaVersion: 1, results }, null, 2));
} finally {
  await pool.end();
}
