import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { configurePackagedBrowserPath } from './runtime-layout.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('packaged browser runtime layout', () => {
  it('prefers the package-local Chromium payload over an ambient cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tasktwin-runtime-layout-'));
    temporaryDirectories.push(root);
    const browserPath = join(root, 'browsers');
    await mkdir(browserPath);
    const environment: NodeJS.ProcessEnv = {
      PLAYWRIGHT_BROWSERS_PATH: 'C:\\untrusted-browser-cache',
    };

    await configurePackagedBrowserPath(
      pathToFileURL(`${browserPath}${sep}`),
      environment,
    );

    expect(environment['PLAYWRIGHT_BROWSERS_PATH']).toBe(
      `${browserPath}${sep}`,
    );
  });

  it('preserves the development setting when no packaged payload exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tasktwin-runtime-layout-'));
    temporaryDirectories.push(root);
    const environment: NodeJS.ProcessEnv = {
      PLAYWRIGHT_BROWSERS_PATH: 'C:\\development-browser-cache',
    };

    await configurePackagedBrowserPath(
      pathToFileURL(`${join(root, 'missing')}${sep}`),
      environment,
    );

    expect(environment['PLAYWRIGHT_BROWSERS_PATH']).toBe(
      'C:\\development-browser-cache',
    );
  });
});
