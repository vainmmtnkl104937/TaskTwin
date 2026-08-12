import { ValidationPipe, type INestApplication } from '@nestjs/common';
import helmet from 'helmet';

import { getHttpSecurityConfiguration } from './environment.js';
import { CorrelationIdMiddleware } from '../http-security/correlation-id.middleware.js';
import {
  getCorrelationId,
  type SecurityHttpRequest,
} from '../http-security/http-request.js';

interface ConfigurableApplication extends INestApplication {
  useBodyParser(type: 'json', options: { limit: number; strict: true }): this;
}

interface ExpressApplication {
  disable(name: string): void;
  set(name: string, value: number): void;
}

export function configureApplication(app: INestApplication): void {
  const security = getHttpSecurityConfiguration();
  const configurable = app as ConfigurableApplication;
  const express = app.getHttpAdapter().getInstance() as ExpressApplication;
  express.disable('x-powered-by');
  if (security.trustedProxyHops > 0) {
    express.set('trust proxy', security.trustedProxyHops);
  }
  const correlation = new CorrelationIdMiddleware();
  app.use(
    (
      request: SecurityHttpRequest,
      response: { setHeader(name: string, value: string): void },
      next: () => void,
    ) => correlation.use(request, response, next),
  );
  configurable.useBodyParser('json', {
    limit: security.bodyLimitBytes,
    strict: true,
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      hsts:
        process.env.NODE_ENV === 'production'
          ? { maxAge: 31_536_000, includeSubDomains: true }
          : false,
    }),
  );
  app.enableCors({
    credentials: false,
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Request-Id',
      'X-TaskTwin-Run-Lease',
    ],
    exposedHeaders: [
      'X-Request-Id',
      'Retry-After',
      'X-TaskTwin-Runner-Compatibility',
      'X-TaskTwin-Runner-Compliance',
      'X-TaskTwin-Runner-Desired-Version',
    ],
    maxAge: 600,
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allowed?: boolean) => void,
    ) =>
      callback(null, origin === undefined || origin === security.allowedOrigin),
  });
  app.use(
    (
      request: SecurityHttpRequest & {
        originalUrl?: string;
        url?: string;
        rawHeaders?: string[];
      },
      response: {
        setHeader(name: string, value: string): void;
        status(code: number): { json(body: unknown): void };
      },
      next: () => void,
    ) => {
      const url = request.originalUrl ?? request.url ?? '';
      const headerBytes = (request.rawHeaders ?? []).reduce(
        (total, value) => total + Buffer.byteLength(value),
        0,
      );
      if (headerBytes > 16_384) {
        response.status(431).json({
          statusCode: 431,
          code: 'REQUEST_HEADERS_TOO_LARGE',
          message: 'The request headers are too large.',
          correlationId: getCorrelationId(request),
        });
        return;
      }
      if (url.length > 8_192) {
        response.status(414).json({
          statusCode: 414,
          code: 'REQUEST_URI_TOO_LONG',
          message: 'The request URI is too long.',
          correlationId: getCorrelationId(request),
        });
        return;
      }
      response.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      validationError: {
        target: false,
        value: false,
      },
    }),
  );
}
