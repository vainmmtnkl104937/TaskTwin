import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOptions } from './release-script-utils.mjs';

const ALLOWED_ROOT_FILES = new Set(['package.json', 'runner.cmd']);
const ALLOWED_ROOT_DIRECTORIES = new Set([
  'browsers',
  'dist',
  'node_modules',
  'runtime',
  'windows',
]);
const FORBIDDEN_SEGMENTS = new Set([
  '.git',
  '.tasktwin',
  '.turbo',
  '__tests__',
  'browser-profile',
  'coverage',
  'fixtures',
  'profiles',
  'src',
  'storage-state',
  'test',
  'tests',
  'user-data',
]);
const FORBIDDEN_FILE_NAMES = [
  /^\.env(?:\..*)?$/i,
  /^local-secret-vault(?:\..*)?$/i,
  /^runner-credential\.json$/i,
  /^runner-encryption-key\.json$/i,
  /^runner-service(?:\..*)?\.json$/i,
  /storage-?state/i,
  /cookies?\.json$/i,
  /private[-_.]?key/i,
  /signing[-_.]?key/i,
  /\.pem$/i,
  /\.key$/i,
];
const PROHIBITED_CONTENT = [
  'LOCAL_SECRET_STORE_LEAK_31',
  'RUNNER_CREDENTIAL_LEAK_31',
  'RELEASE_PRIVATE_KEY_LEAK_31',
  'CLI_RECOGNIZABLE_SECRET_29',
  'SESSION_29_RECOGNIZABLE_PASSWORD',
  'API_RECOGNIZABLE_SECRET_29',
  'fixture-secret-30',
  'server-only-access-token',
  'password-plaintext',
  '-----BEGIN PRIVATE KEY-----',
];
const MAX_PACKAGE_FILE_COUNT = 100_000;

async function containsProhibitedContent(path) {
  const sentinels = PROHIBITED_CONTENT.map((value) =>
    Buffer.from(value, 'utf8'),
  );
  const longest = Math.max(...sentinels.map((value) => value.length));
  let tail = Buffer.alloc(0);
  for await (const value of createReadStream(path, {
    highWaterMark: 64 * 1024,
  })) {
    const chunk = Buffer.concat([tail, value]);
    if (sentinels.some((sentinel) => chunk.indexOf(sentinel) !== -1))
      return true;
    tail = chunk.subarray(Math.max(0, chunk.length - longest + 1));
  }
  return false;
}

function validateRelativePath(relativePath, directory) {
  const normalized = relativePath.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (
    normalized.startsWith('/') ||
    segments.includes('') ||
    segments.includes('.') ||
    segments.includes('..')
  ) {
    throw new Error('Release staging contains an invalid relative path.');
  }
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  if (lowerSegments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    throw new Error(
      `Release staging contains a prohibited path: ${normalized}`,
    );
  }
  if (
    FORBIDDEN_FILE_NAMES.some((pattern) => pattern.test(segments.at(-1) ?? ''))
  ) {
    throw new Error(
      `Release staging contains a prohibited file name: ${normalized}`,
    );
  }
  const root = lowerSegments[0] ?? '';
  if (segments.length === 1) {
    if (
      directory
        ? !ALLOWED_ROOT_DIRECTORIES.has(root)
        : !ALLOWED_ROOT_FILES.has(root)
    ) {
      throw new Error(
        `Release staging contains a non-allowlisted root entry: ${normalized}`,
      );
    }
  } else if (!ALLOWED_ROOT_DIRECTORIES.has(root)) {
    throw new Error(
      `Release staging contains a non-allowlisted root: ${normalized}`,
    );
  }
  if (
    root === 'dist' &&
    !directory &&
    !['.js', '.json', '.ps1'].includes(extname(normalized).toLowerCase())
  ) {
    throw new Error(
      `Release staging contains a non-runtime dist file: ${normalized}`,
    );
  }
  if (normalized.toLowerCase().endsWith('.map')) {
    throw new Error(`Release staging contains a source map: ${normalized}`);
  }
}

export async function inspectReleaseStaging(stagingDirectory) {
  const root = resolve(stagingDirectory);
  if (
    !/^tasktwin-runner-(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?-windows-x64$/.test(
      basename(root),
    )
  ) {
    throw new Error('The release staging directory name is invalid.');
  }
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Release staging must be a regular directory.');
  }
  const seen = new Set();
  let fileCount = 0;
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).replaceAll('\\', '/');
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Release staging contains a symbolic link: ${relativePath}`,
        );
      }
      const caseKey = relativePath.toLowerCase();
      if (seen.has(caseKey)) {
        throw new Error(
          `Release staging contains a case-colliding path: ${relativePath}`,
        );
      }
      seen.add(caseKey);
      validateRelativePath(relativePath, stat.isDirectory());
      if (stat.isDirectory()) {
        await visit(path);
      } else if (stat.isFile()) {
        fileCount += 1;
        if (fileCount > MAX_PACKAGE_FILE_COUNT) {
          throw new Error('Release staging contains too many files.');
        }
        if (await containsProhibitedContent(path)) {
          throw new Error(
            `Release staging contains prohibited content: ${relativePath}`,
          );
        }
      } else {
        throw new Error(
          `Release staging contains a non-regular file: ${relativePath}`,
        );
      }
    }
  }
  await visit(root);
  for (const required of [
    'runner.cmd',
    'package.json',
    'dist/index.js',
    'dist/release/build-identity.json',
    'runtime/node.exe',
    'runtime/LICENSE',
    'windows/vendor/winsw-2.12.0/WinSW.NET461.exe',
  ]) {
    if (!seen.has(required.toLowerCase())) {
      throw new Error(
        `Release staging is missing required runtime file: ${required}`,
      );
    }
  }
  if (![...seen].some((path) => path.startsWith('browsers/chromium-'))) {
    throw new Error('Release staging is missing packaged Chromium.');
  }
  const packageJson = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  );
  if (
    Object.hasOwn(packageJson, 'scripts') ||
    Object.hasOwn(packageJson, 'devDependencies')
  ) {
    throw new Error(
      'Release package metadata contains development configuration.',
    );
  }
  return { fileCount };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseOptions(process.argv.slice(2), {
    '--staging-dir': true,
  });
  const result = await inspectReleaseStaging(options['--staging-dir']);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
