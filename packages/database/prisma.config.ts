import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'prisma/config';

const rootEnvironmentPath = fileURLToPath(
  new URL('../../.env', import.meta.url),
);

if (existsSync(rootEnvironmentPath)) {
  process.loadEnvFile(rootEnvironmentPath);
}

const generationOnlyDatabaseUrl =
  'postgresql://generation-only:generation-only@127.0.0.1:1/generation-only';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? generationOnlyDatabaseUrl,
  },
});
