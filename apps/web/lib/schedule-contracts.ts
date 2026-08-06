import { z } from 'zod';

/**
 * IANA timezone names that are always valid and commonly used.
 */
export const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'America/Mexico_City',
  'Africa/Johannesburg',
  'Africa/Lagos',
] as const;

/**
 * Local date in YYYY-MM-DD format.
 */
export const LocalDateSchema = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
    'Local date must be YYYY-MM-DD.',
  );

/**
 * Local time in HH:MM format (24-hour).
 */
export const LocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Local time must be HH:MM (24-hour).');

/**
 * Weekday as an integer following ISO 8601 convention:
 * Monday = 1 ... Sunday = 7.
 */
export const WeekdaySchema = z.number().int().min(1).max(7);

export type Weekday = z.infer<typeof WeekdaySchema>;

export const OneTimeScheduleDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal('one_time'),
  timezone: z.string(),
  date: LocalDateSchema,
  time: LocalTimeSchema,
});

export type OneTimeScheduleDefinition = z.infer<typeof OneTimeScheduleDefinitionSchema>;

export const DailyScheduleDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal('daily'),
  timezone: z.string(),
  startDate: LocalDateSchema,
  endDate: LocalDateSchema.optional(),
  time: LocalTimeSchema,
  intervalDays: z.number().int().min(1).max(365).default(1),
});

export type DailyScheduleDefinition = z.infer<typeof DailyScheduleDefinitionSchema>;

export const WeeklyScheduleDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal('weekly'),
  timezone: z.string(),
  startDate: LocalDateSchema,
  endDate: LocalDateSchema.optional(),
  time: LocalTimeSchema,
  weekdays: z.array(WeekdaySchema).min(1).max(7).default([1]),
  intervalWeeks: z.number().int().min(1).max(52).default(1),
});

export type WeeklyScheduleDefinition = z.infer<typeof WeeklyScheduleDefinitionSchema>;

export const ScheduleDefinitionSchema: z.ZodType<
  OneTimeScheduleDefinition | DailyScheduleDefinition | WeeklyScheduleDefinition
> = z.discriminatedUnion('type', [
  OneTimeScheduleDefinitionSchema,
  DailyScheduleDefinitionSchema,
  WeeklyScheduleDefinitionSchema,
]);

export type ScheduleDefinition = z.infer<typeof ScheduleDefinitionSchema>;
