import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getRequiredDatabaseUrl } from '@tasktwin/database';

export function loadRootEnvironment(): void {
  if (process.env.NODE_ENV === 'production') return;
  const path = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}

export function validateNotificationWorkerEnvironment(): void {
  getRequiredDatabaseUrl();
}
