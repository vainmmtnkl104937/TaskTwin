import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createDatabaseClient,
  getRequiredDatabaseUrl,
  type PrismaClient,
} from '@tasktwin/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/config/configure-application.js';
import { loadRootEnvironment } from '../src/config/environment.js';

interface RegistrationBody {
  user: {
    id: string;
    email: string;
  };
  organization: {
    id: string;
    role: string;
  };
  workspace: {
    id: string;
    organizationId: string;
  };
  accessToken: string;
}

interface WorkspaceListBody {
  workspaces: Array<{
    id: string;
    organizationId: string;
  }>;
}

describe('authentication and workspace integration', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaClient | undefined;
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const suffix = crypto.randomUUID();
  const firstEmail = `session04-first-${suffix}@example.test`;
  const secondEmail = `session04-second-${suffix}@example.test`;
  const password = 'Session04 integration password';
  let firstRegistration: RegistrationBody;
  let secondRegistration: RegistrationBody;

  beforeAll(async () => {
    loadRootEnvironment();
    prisma = createDatabaseClient(getRequiredDatabaseUrl());
    await prisma.$connect();

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    try {
      if (prisma !== undefined) {
        if (organizationIds.length > 0) {
          await prisma.workspace.deleteMany({
            where: { organizationId: { in: organizationIds } },
          });
          await prisma.organization.deleteMany({
            where: { id: { in: organizationIds } },
          });
        }
        if (userIds.length > 0) {
          await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        }
        await prisma.$disconnect();
      }
    } finally {
      if (app !== undefined) {
        await app.close();
      }
    }
  });

  it('registers two isolated owners with their default workspaces', async () => {
    if (app === undefined || prisma === undefined) {
      throw new Error('Integration application was not initialized');
    }

    const firstResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `  ${firstEmail.toUpperCase()}  `,
        password,
        displayName: 'First Owner',
        organizationName: 'First Organization',
      })
      .expect(201);
    firstRegistration = firstResponse.body as RegistrationBody;
    userIds.push(firstRegistration.user.id);
    organizationIds.push(firstRegistration.organization.id);

    const secondResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: secondEmail,
        password,
        displayName: 'Second Owner',
        organizationName: 'Second Organization',
      })
      .expect(201);
    secondRegistration = secondResponse.body as RegistrationBody;
    userIds.push(secondRegistration.user.id);
    organizationIds.push(secondRegistration.organization.id);

    expect(firstRegistration.user.email).toBe(firstEmail);
    expect(firstRegistration.organization.role).toBe('OWNER');
    expect(firstRegistration.workspace.organizationId).toBe(
      firstRegistration.organization.id,
    );
    expect(JSON.stringify(firstResponse.body)).not.toContain('passwordHash');
    expect(JSON.stringify(secondResponse.body)).not.toContain('passwordHash');

    const storedUser = await prisma.user.findUniqueOrThrow({
      where: { id: firstRegistration.user.id },
      select: { passwordHash: true },
    });
    expect(storedUser.passwordHash).toMatch(/^\$argon2id\$/);
    expect(storedUser.passwordHash).not.toBe(password);

    const membership = await prisma.organizationMember.findUniqueOrThrow({
      where: {
        userId_organizationId: {
          userId: firstRegistration.user.id,
          organizationId: firstRegistration.organization.id,
        },
      },
    });
    expect(membership.role).toBe('OWNER');
  });

  it('rejects duplicate normalized email registration', async () => {
    if (app === undefined) {
      throw new Error('Integration application was not initialized');
    }

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: firstEmail.toUpperCase(),
        password,
        displayName: 'Duplicate Owner',
        organizationName: 'Duplicate Organization',
      })
      .expect(409);
  });

  it('logs in, resolves /auth/me and scopes /workspaces by membership', async () => {
    if (app === undefined) {
      throw new Error('Integration application was not initialized');
    }

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: firstEmail, password })
      .expect(200);
    const accessToken = (loginResponse.body as { accessToken: string })
      .accessToken;

    const meResponse = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(meResponse.body).toMatchObject({
      user: { id: firstRegistration.user.id, email: firstEmail },
    });

    const workspaceResponse = await request(app.getHttpServer())
      .get('/workspaces')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const body = workspaceResponse.body as WorkspaceListBody;
    expect(body.workspaces).toEqual([
      expect.objectContaining({ id: firstRegistration.workspace.id }),
    ]);
    expect(body.workspaces).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: secondRegistration.workspace.id }),
      ]),
    );
    expect(JSON.stringify(loginResponse.body)).not.toContain('passwordHash');
    expect(JSON.stringify(meResponse.body)).not.toContain('passwordHash');
    expect(JSON.stringify(workspaceResponse.body)).not.toContain(
      'passwordHash',
    );
  });

  it('returns the same generic error for invalid credentials', async () => {
    if (app === undefined) {
      throw new Error('Integration application was not initialized');
    }

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: firstEmail, password: 'incorrect password' })
      .expect(401);
    expect(response.body).toMatchObject({
      message: 'Invalid email or password',
    });
  });

  it('rejects unauthenticated protected requests', async () => {
    if (app === undefined) {
      throw new Error('Integration application was not initialized');
    }

    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer()).get('/workspaces').expect(401);
  });
});
