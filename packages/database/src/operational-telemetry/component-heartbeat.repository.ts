import {
  OperationalTelemetryError,
  OperationalComponentTypeSchema,
  type ComponentHeartbeatSample,
  type OperationalComponentType,
} from '@tasktwin/operational-telemetry';

import type { PrismaClient } from '../generated/prisma/client.js';

interface HeartbeatRow {
  componentType: string;
  startedAt: Date;
  latestHeartbeatAt: Date;
  gracefulStoppedAt: Date | null;
}

export class ComponentHeartbeatRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async register(input: {
    processInstanceId: string;
    componentType: OperationalComponentType;
  }): Promise<void> {
    const componentType = OperationalComponentTypeSchema.parse(
      input.componentType,
    );
    try {
      const changed = await this.prisma.$executeRaw`
        INSERT INTO "operational_component_heartbeats" (
          "process_instance_id", "component_type", "started_at", "latest_heartbeat_at"
        ) VALUES (
          ${input.processInstanceId}::uuid,
          ${componentType}::"operational_component_type",
          clock_timestamp(),
          clock_timestamp()
        )
        ON CONFLICT ("process_instance_id") DO UPDATE SET
          "latest_heartbeat_at" = clock_timestamp()
        WHERE "operational_component_heartbeats"."component_type" = EXCLUDED."component_type"
          AND "operational_component_heartbeats"."graceful_stopped_at" IS NULL
      `;
      if (changed !== 1) {
        throw new OperationalTelemetryError('TELEMETRY_INVALID');
      }
    } catch (cause) {
      throw new OperationalTelemetryError('TELEMETRY_STORAGE_UNAVAILABLE', {
        cause,
      });
    }
  }

  async refresh(processInstanceId: string): Promise<boolean> {
    try {
      const changed = await this.prisma.$executeRaw`
        UPDATE "operational_component_heartbeats"
        SET "latest_heartbeat_at" = clock_timestamp()
        WHERE "process_instance_id" = ${processInstanceId}::uuid
          AND "graceful_stopped_at" IS NULL
      `;
      return changed === 1;
    } catch (cause) {
      throw new OperationalTelemetryError('TELEMETRY_STORAGE_UNAVAILABLE', {
        cause,
      });
    }
  }

  async stop(processInstanceId: string): Promise<boolean> {
    try {
      const changed = await this.prisma.$executeRaw`
        UPDATE "operational_component_heartbeats"
        SET "latest_heartbeat_at" = clock_timestamp(),
            "graceful_stopped_at" = clock_timestamp()
        WHERE "process_instance_id" = ${processInstanceId}::uuid
          AND "graceful_stopped_at" IS NULL
      `;
      return changed === 1;
    } catch (cause) {
      throw new OperationalTelemetryError('TELEMETRY_STORAGE_UNAVAILABLE', {
        cause,
      });
    }
  }

  async listForHealth(): Promise<ComponentHeartbeatSample[]> {
    try {
      const rows = await this.prisma.$queryRaw<HeartbeatRow[]>`
        SELECT heartbeat."component_type"::text AS "componentType",
               heartbeat."started_at" AS "startedAt",
               heartbeat."latest_heartbeat_at" AS "latestHeartbeatAt",
               heartbeat."graceful_stopped_at" AS "gracefulStoppedAt"
        FROM (VALUES
          ('control_plane_api'::"operational_component_type"),
          ('scheduler'::"operational_component_type"),
          ('notification_worker'::"operational_component_type")
        ) AS component("component_type")
        CROSS JOIN LATERAL (
          (SELECT candidate.* FROM "operational_component_heartbeats" candidate
           WHERE candidate."component_type" = component."component_type"
             AND candidate."graceful_stopped_at" IS NULL
           ORDER BY candidate."latest_heartbeat_at" DESC LIMIT 1)
          UNION ALL
          (SELECT candidate.* FROM "operational_component_heartbeats" candidate
           WHERE candidate."component_type" = component."component_type"
             AND candidate."graceful_stopped_at" IS NOT NULL
           ORDER BY candidate."latest_heartbeat_at" DESC LIMIT 1)
        ) heartbeat
      `;
      return rows.map((row) => ({
        componentType: OperationalComponentTypeSchema.parse(row.componentType),
        startedAt: row.startedAt.toISOString(),
        latestHeartbeatAt: row.latestHeartbeatAt.toISOString(),
        gracefulStoppedAt: row.gracefulStoppedAt?.toISOString() ?? null,
      }));
    } catch (cause) {
      throw new OperationalTelemetryError('TELEMETRY_STORAGE_UNAVAILABLE', {
        cause,
      });
    }
  }
}
