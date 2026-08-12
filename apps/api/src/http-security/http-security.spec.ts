import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureApplication } from '../config/configure-application.js';
import { HttpSecurityModule } from './http-security.module.js';
import { redactLogValue } from './redaction.js';
import { ScopedThrottle } from './scoped-throttle.decorator.js';

@Controller('security-test')
class SecurityTestController {
  @Post('login')
  @ScopedThrottle('login')
  login(@Body() body: unknown): unknown {
    return body;
  }

  @Get('domain-error')
  domainError(): never {
    throw new HttpException(
      { code: 'SAFE_CONFLICT', message: 'Safe conflict.' },
      HttpStatus.CONFLICT,
    );
  }

  @Get('unexpected-error')
  unexpectedError(): never {
    throw new Error('database password=must-not-leak');
  }
}

describe('HTTP security boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.TASKTWIN_WEB_BASE_URL = 'https://tasktwin.example.test';
    process.env.RUNNER_PAIRING_CODE_PEPPER = 'p'.repeat(32);
    process.env.RUNNER_CREDENTIAL_PEPPER = 'c'.repeat(32);
    process.env.TASKTWIN_HTTP_BODY_LIMIT_BYTES = '16384';
    const module = await Test.createTestingModule({
      imports: [HttpSecurityModule],
      controllers: [SecurityTestController],
    }).compile();
    app = module.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  }, 30_000);

  it('sets safe headers, cache policy and a correlation identifier', async () => {
    const response = await request(app.getHttpServer())
      .get('/security-test/domain-error')
      .set('X-Request-Id', '4b5e282a-422f-4ca8-9a9b-07409e8a2f47')
      .expect(409);
    expect(response.headers['x-request-id']).toBe(
      '4b5e282a-422f-4ca8-9a9b-07409e8a2f47',
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.body).toMatchObject({
      code: 'SAFE_CONFLICT',
      message: 'Safe conflict.',
      correlationId: '4b5e282a-422f-4ca8-9a9b-07409e8a2f47',
    });
  });

  it('allows only the configured CORS origin', async () => {
    const allowed = await request(app.getHttpServer())
      .options('/security-test/login')
      .set('Origin', 'https://tasktwin.example.test')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://tasktwin.example.test',
    );
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();

    const rejected = await request(app.getHttpServer())
      .options('/security-test/login')
      .set('Origin', 'https://attacker.example.test')
      .set('Access-Control-Request-Method', 'POST')
      .expect(404);
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects oversized JSON before the controller', async () => {
    const response = await request(app.getHttpServer())
      .post('/security-test/login')
      .send({ email: 'large@example.test', payload: 'x'.repeat(20_000) })
      .expect(413);
    expect(response.body).toMatchObject({
      code: 'REQUEST_TOO_LARGE',
      message: 'The request body is too large.',
    });
    expect(JSON.stringify(response.body)).not.toContain('payload');
  });

  it('rate limits repeated login attempts by normalized account', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app.getHttpServer())
        .post('/security-test/login')
        .send({ email: '  OWNER@EXAMPLE.TEST ', password: `wrong-${attempt}` })
        .expect(201);
    }
    const response = await request(app.getHttpServer())
      .post('/security-test/login')
      .send({ email: 'owner@example.test', password: 'wrong-final' })
      .expect(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(response.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(JSON.stringify(response.body)).not.toContain('owner@example.test');
  });

  it('sanitizes unexpected production errors', async () => {
    const response = await request(app.getHttpServer())
      .get('/security-test/unexpected-error')
      .expect(500);
    expect(response.body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'The request could not be completed.',
    });
    expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });

  it('redacts nested credentials, tokens and runtime values from logs', () => {
    const value = redactLogValue({
      authorization: 'Bearer token-value',
      nested: {
        leaseToken: 'lease-value',
        message: 'Authorization: Bearer another-token',
        runtimeInput: 'private-runtime-value',
      },
    });
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain('token-value');
    expect(serialized).not.toContain('lease-value');
    expect(serialized).not.toContain('private-runtime-value');
    expect(serialized).toContain('[REDACTED]');
  });
});
