import { z } from 'zod';

import {
  MAX_CLIENT_BATCH_ID_LENGTH,
  MAX_RECORDING_EVENTS,
  MAX_RECORDING_ORIGIN_LENGTH,
} from './constants.js';

export const TimestampSchema = z.string().datetime({ offset: true });
export const UuidSchema = z.string().uuid();

export const OriginSchema = z
  .string()
  .max(MAX_RECORDING_ORIGIN_LENGTH)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value
    );
  }, 'Must be a canonical HTTP or HTTPS origin.');

export const RecordingEventCountSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_RECORDING_EVENTS);

export const RecordingLastSequenceSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_RECORDING_EVENTS);

export const RecordingSequenceSchema = z.number().int().positive();

export const ClientBatchIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_CLIENT_BATCH_ID_LENGTH);
