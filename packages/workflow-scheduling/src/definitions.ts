import { z } from 'zod';

import { WORKFLOW_SCHEDULING_SCHEMA_VERSION } from './constants.js';
import { isValidIanaTimezone } from './timezone.js';

// ---------------------------------------------------------------------------
// IANA timezone validation
// ---------------------------------------------------------------------------

/** Valid IANA timezone identifier, e.g. "America/New_York", "UTC". */
export const IanaTimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .superRefine((value, ctx) => {
    if (!isValidIanaTimezone(value)) {
      ctx.addIssue({
        code: 'custom',
        message: `"${value}" is not a recognised IANA timezone identifier.`,
      });
    }
  })
  .brand<'IanaTimezone'>();

export type IanaTimezone = z.infer<typeof IanaTimezoneSchema>;

// ---------------------------------------------------------------------------
// Local date / time primitives (wall-clock, no timezone)
// ---------------------------------------------------------------------------

/** Local date in YYYY-MM-DD format. */
export const LocalDateSchema = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
    'Local date must be YYYY-MM-DD.',
  );

/** Local time in HH:MM format (24-hour). */
export const LocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Local time must be HH:MM (24-hour).');

// ---------------------------------------------------------------------------
// Weekday representation
// ---------------------------------------------------------------------------

/**
 * Weekday as an integer following ISO 8601 convention:
 * Monday = 1 … Sunday = 7.
 */
export const WeekdaySchema = z
  .number()
  .int()
  .min(1)
  .max(7);

export type Weekday = z.infer<typeof WeekdaySchema>;

// ---------------------------------------------------------------------------
// Schedule definitions
// ---------------------------------------------------------------------------

/**
 * One-time schedule: fires exactly once at the specified local instant.
 */
export const OneTimeScheduleDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(WORKFLOW_SCHEDULING_SCHEMA_VERSION),
    type: z.literal('one_time'),
    timezone: IanaTimezoneSchema,
    date: LocalDateSchema,
    time: LocalTimeSchema,
  })
  .describe('A one-time schedule that fires at a single future instant.');

export type OneTimeScheduleDefinition = z.infer<
  typeof OneTimeScheduleDefinitionSchema
>;

/**
 * Daily schedule: fires every day at the same local time between startDate
 * and optionally endDate.
 *
 * @param intervalDays  – fires every N days (default 1).  Bounded 1-365.
 * @param startDate    – first firing date (inclusive)
 * @param endDate      – last firing date (inclusive), optional
 * @param time         – wall-clock time in the given IANA timezone
 * @param timezone     – IANA timezone for interpreting the local time
 */
export const DailyScheduleDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(WORKFLOW_SCHEDULING_SCHEMA_VERSION),
    type: z.literal('daily'),
    timezone: IanaTimezoneSchema,
    startDate: LocalDateSchema,
    endDate: LocalDateSchema.optional(),
    time: LocalTimeSchema,
    intervalDays: z.number().int().min(1).max(365).default(1),
  })
  .refine(
    (def) =>
      def.endDate === undefined || def.endDate >= def.startDate,
    {
      message: 'endDate must not be before startDate.',
      path: ['endDate'],
    },
  )
  .describe('A daily recurring schedule.');

export type DailyScheduleDefinition = z.infer<
  typeof DailyScheduleDefinitionSchema
>;

/**
 * Weekly schedule: fires on specific weekdays at the same local time between
 * startDate and optionally endDate.
 *
 * @param weekdays     – sorted ISO 8601 weekday numbers (1=Mon … 7=Sun), unique
 * @param intervalWeeks – fires every N weeks (default 1).  Bounded 1-52.
 * @param startDate    – first firing date (inclusive)
 * @param endDate      – last firing date (inclusive), optional
 * @param time         – wall-clock time in the given IANA timezone
 * @param timezone     – IANA timezone for interpreting the local time
 */
export const WeeklyScheduleDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(WORKFLOW_SCHEDULING_SCHEMA_VERSION),
    type: z.literal('weekly'),
    timezone: IanaTimezoneSchema,
    startDate: LocalDateSchema,
    endDate: LocalDateSchema.optional(),
    time: LocalTimeSchema,
    weekdays: z
      .array(WeekdaySchema)
      .min(1)
      .max(7)
      .default([1]),
    intervalWeeks: z.number().int().min(1).max(52).default(1),
  })
  .refine(
    (def) =>
      def.endDate === undefined || def.endDate >= def.startDate,
    {
      message: 'endDate must not be before startDate.',
      path: ['endDate'],
    },
  )
  .transform((def) => ({
    ...def,
    // Sort and deduplicate weekdays at parse time
    weekdays: [...new Set(def.weekdays)].sort(
      (a, b) => a - b,
    ) as [Weekday, ...Weekday[]],
  }))
  .superRefine((def, ctx) => {
    if (def.weekdays.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'At least one weekday is required.',
        path: ['weekdays'],
      });
    }
    if (new Set(def.weekdays).size !== def.weekdays.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Weekdays must be unique.',
        path: ['weekdays'],
      });
    }
  })
  .describe('A weekly recurring schedule on selected weekdays.');

export type WeeklyScheduleDefinition = z.infer<
  typeof WeeklyScheduleDefinitionSchema
>;

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

/** Any valid schedule definition. */
export const ScheduleDefinitionSchema: z.ZodType<
  OneTimeScheduleDefinition | DailyScheduleDefinition | WeeklyScheduleDefinition
> = z.discriminatedUnion('type', [
  OneTimeScheduleDefinitionSchema,
  DailyScheduleDefinitionSchema,
  WeeklyScheduleDefinitionSchema,
]);

export type ScheduleDefinition = z.infer<typeof ScheduleDefinitionSchema>;

// ---------------------------------------------------------------------------
// Serialisation roundtrip helpers
// ---------------------------------------------------------------------------

/**
 * Persisted schedule definition as stored in the database.
 * Stored as plain JSON — this is just a type alias.
 */
export type PersistedScheduleDefinition = ScheduleDefinition;
