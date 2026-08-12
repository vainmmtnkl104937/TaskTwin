import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';

import {
  CORRELATION_ID_HEADER,
  REQUEST_CORRELATION_ID,
  type SecurityHttpRequest,
} from './http-request.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(
    request: SecurityHttpRequest,
    response: HeaderResponse,
    next: () => void,
  ): void {
    const raw = request.headers[CORRELATION_ID_HEADER];
    const candidate = Array.isArray(raw) ? undefined : raw;
    const correlationId =
      candidate !== undefined && UUID_PATTERN.test(candidate)
        ? candidate.toLowerCase()
        : randomUUID();
    request[REQUEST_CORRELATION_ID] = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  }
}
