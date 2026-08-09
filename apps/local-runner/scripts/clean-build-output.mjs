import { rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(applicationRoot, 'dist');
if (relative(applicationRoot, outputDirectory) !== 'dist') {
  throw new Error('The Local Runner build output path is invalid.');
}
await rm(outputDirectory, { recursive: true, force: true });
