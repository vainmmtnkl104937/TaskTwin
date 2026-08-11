import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadRootEnvironment,
  validateNotificationWorkerEnvironment,
} from '../src/environment.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.restoreAllMocks();
});

describe('notification worker environment', () => {
  it('validates its database configuration', () => {
    process.env.DATABASE_URL =
      'postgresql://tasktwin:test@127.0.0.1:5432/tasktwin';
    delete process.env.DATABASE_URL_FILE;
    expect(() => validateNotificationWorkerEnvironment()).not.toThrow();
  });

  it('does not load repository dotenv files in production', () => {
    process.env.NODE_ENV = 'production';
    const load = vi.spyOn(process, 'loadEnvFile');
    loadRootEnvironment();
    expect(load).not.toHaveBeenCalled();
  });
});
