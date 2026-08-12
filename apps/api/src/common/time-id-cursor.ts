import { z } from 'zod';

const TimeIdCursorSchema = z.strictObject({
  time: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});

export interface TimeIdCursor {
  time: Date;
  id: string;
}

export function encodeTimeIdCursor(value: TimeIdCursor): string {
  return Buffer.from(
    JSON.stringify({ time: value.time.toISOString(), id: value.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeTimeIdCursor(value: string): TimeIdCursor {
  const decoded: unknown = JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8'),
  );
  const parsed = TimeIdCursorSchema.parse(decoded);
  return { time: new Date(parsed.time), id: parsed.id };
}
