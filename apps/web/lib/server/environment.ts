import 'server-only';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

function loadRootEnvironment(): void {
  if (loaded) {
    return;
  }
  loaded = true;

  const rootEnvironmentPath = resolve(process.cwd(), '..', '..', '.env');
  if (existsSync(rootEnvironmentPath)) {
    process.loadEnvFile(rootEnvironmentPath);
  }
}

export function getControlPlaneOrigin(): string {
  loadRootEnvironment();
  const configured =
    process.env.TASKTWIN_API_BASE_URL ?? 'http://127.0.0.1:3001';

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('TASKTWIN_API_BASE_URL must be a valid URL origin.');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(
      'TASKTWIN_API_BASE_URL must be an HTTP(S) origin without credentials.',
    );
  }

  return url.origin;
}
