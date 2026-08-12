import type { IncomingMessage } from 'node:http';

export const CORRELATION_ID_HEADER = 'x-request-id';
export const REQUEST_CORRELATION_ID = Symbol('request-correlation-id');

export interface SecurityHttpRequest extends IncomingMessage {
  headers: IncomingMessage['headers'];
  ip?: string;
  ips?: string[];
  body?: unknown;
  [REQUEST_CORRELATION_ID]?: string;
}

export function getCorrelationId(request: SecurityHttpRequest): string {
  return request[REQUEST_CORRELATION_ID] ?? 'correlation-unavailable';
}
