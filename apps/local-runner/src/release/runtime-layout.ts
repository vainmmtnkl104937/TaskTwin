import { lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function configurePackagedBrowserPath(
  browserUrl = new URL('../../browsers/', import.meta.url),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const directory = await lstat(browserUrl).catch(() => null);
  if (
    directory !== null &&
    directory.isDirectory() &&
    !directory.isSymbolicLink()
  ) {
    environment['PLAYWRIGHT_BROWSERS_PATH'] = fileURLToPath(browserUrl);
  }
}
