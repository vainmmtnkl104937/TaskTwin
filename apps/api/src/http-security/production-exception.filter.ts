import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
  type LoggerService,
} from '@nestjs/common';

import { getCorrelationId, type SecurityHttpRequest } from './http-request.js';

const MAXIMUM_CODE_LENGTH = 100;
const MAXIMUM_MESSAGE_LENGTH = 240;
const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,99}$/u;

interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeCode(value: unknown, fallback: string): string {
  return typeof value === 'string' &&
    value.length <= MAXIMUM_CODE_LENGTH &&
    SAFE_CODE_PATTERN.test(value)
    ? value
    : fallback;
}

function safeMessage(value: unknown, fallback: string): string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAXIMUM_MESSAGE_LENGTH
    ? value
    : fallback;
}

function statusDefaults(status: number): { code: string; message: string } {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return { code: 'REQUEST_INVALID', message: 'The request is invalid.' };
    case HttpStatus.UNAUTHORIZED:
      return {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
      };
    case HttpStatus.FORBIDDEN:
      return { code: 'ACCESS_FORBIDDEN', message: 'Access is forbidden.' };
    case HttpStatus.NOT_FOUND:
      return {
        code: 'RESOURCE_NOT_FOUND',
        message: 'The resource was not found.',
      };
    case HttpStatus.CONFLICT:
      return {
        code: 'RESOURCE_CONFLICT',
        message: 'The request conflicts with current state.',
      };
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return {
        code: 'REQUEST_TOO_LARGE',
        message: 'The request body is too large.',
      };
    case HttpStatus.TOO_MANY_REQUESTS:
      return { code: 'RATE_LIMITED', message: 'Too many requests.' };
    case HttpStatus.SERVICE_UNAVAILABLE:
      return {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The service is temporarily unavailable.',
      };
    default:
      return status >= 500
        ? {
            code: 'INTERNAL_ERROR',
            message: 'The request could not be completed.',
          }
        : { code: 'REQUEST_REJECTED', message: 'The request was rejected.' };
  }
}

function safeExtension(
  key: string,
  value: unknown,
): Record<string, unknown> | undefined {
  if (
    key === 'currentRevision' &&
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0
  ) {
    return { currentRevision: value };
  }
  if (key === 'readiness' || key === 'issues' || key === 'checks') {
    return { [key]: value };
  }
  return undefined;
}

@Catch()
export class ProductionExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<SecurityHttpRequest>();
    const response = http.getResponse<JsonResponse>();
    const parserError = isRecord(exception) ? exception : undefined;
    const parserStatus =
      parserError?.type === 'entity.too.large' && parserError.status === 413
        ? HttpStatus.PAYLOAD_TOO_LARGE
        : parserError?.type === 'entity.parse.failed' &&
            parserError.status === 400
          ? HttpStatus.BAD_REQUEST
          : undefined;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : (parserStatus ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const defaults = statusDefaults(status);
    const raw =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const record = isRecord(raw) ? raw : undefined;
    const explicitMessage =
      typeof raw === 'string'
        ? raw
        : typeof record?.message === 'string'
          ? record.message
          : undefined;
    if (
      status === HttpStatus.SERVICE_UNAVAILABLE &&
      record?.status === 'not_ready' &&
      Array.isArray(record.checks)
    ) {
      response.status(status).json({
        status: 'not_ready',
        checks: record.checks,
      });
      return;
    }
    const body: Record<string, unknown> = {
      statusCode: status,
      code: safeCode(record?.code, defaults.code),
      message:
        status >= 500
          ? defaults.message
          : safeMessage(
              explicitMessage === 'Invalid email or password' ||
                (typeof record?.code === 'string' &&
                  SAFE_CODE_PATTERN.test(record.code))
                ? explicitMessage
                : undefined,
              defaults.message,
            ),
      correlationId: getCorrelationId(request),
    };
    if (record !== undefined) {
      for (const [key, value] of Object.entries(record)) {
        const extension = safeExtension(key, value);
        if (extension !== undefined) Object.assign(body, extension);
      }
    }
    if (status >= 500) {
      const internalCode = isRecord(exception)
        ? safeCode(exception.code, 'UNCLASSIFIED_ERROR')
        : 'UNCLASSIFIED_ERROR';
      this.logger.error({
        event: 'HTTP_REQUEST_FAILED',
        statusCode: status,
        correlationId: getCorrelationId(request),
        method: request.method,
        errorType: exception instanceof Error ? exception.name : 'UnknownError',
        internalCode,
      });
    }
    response.status(status).json(body);
  }
}
