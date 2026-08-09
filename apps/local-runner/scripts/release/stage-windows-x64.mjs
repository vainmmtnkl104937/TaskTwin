import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RUNNER_RELEASE_ARCHITECTURE,
  RUNNER_RELEASE_PLATFORM,
  RunnerBuildIdentitySchema,
  expectedRunnerArtifactFileName,
} from '@tasktwin/runner-release';

import { inspectReleaseStaging } from './inspect-release-staging.mjs';
import { parseOptions, readRegularJson } from './release-script-utils.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const applicationRoot = resolve(scriptDirectory, '..', '..');
const repositoryRoot = resolve(applicationRoot, '..', '..');
const INTERNAL_PACKAGE_PREFIX = '@tasktwin/';
const WIN_SW_SHA256 =
  'b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f';
const DEVELOPMENT_DIRECTORY_NAMES = new Set([
  '.git',
  '.github',
  '.turbo',
  '__tests__',
  'coverage',
  'fixtures',
  'src',
  'test',
  'tests',
]);

function sanitizedPackageJson(packageJson, identity) {
  return {
    name: packageJson.name,
    version: identity.version,
    private: true,
    type: 'module',
    main: './dist/index.js',
    engines: { node: '>=22.13.0 <23' },
  };
}

async function copyTree(source, destination, filter) {
  const sourceRoot = await realpath(source);
  async function visit(currentSource, currentDestination, relativePath) {
    const entries = await readdir(currentSource, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    await mkdir(currentDestination, { recursive: true });
    for (const entry of entries) {
      const sourcePath = join(currentSource, entry.name);
      const nextRelative =
        relativePath === '' ? entry.name : `${relativePath}/${entry.name}`;
      const stat = await lstat(sourcePath);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Release source contains a symbolic link: ${nextRelative}`,
        );
      }
      if (!filter(nextRelative, stat.isDirectory())) continue;
      const destinationPath = join(currentDestination, entry.name);
      if (stat.isDirectory()) {
        await visit(sourcePath, destinationPath, nextRelative);
      } else if (stat.isFile()) {
        await cp(sourcePath, destinationPath, {
          force: false,
          errorOnExist: true,
          preserveTimestamps: false,
        });
      } else {
        throw new Error(
          `Release source is not a regular file: ${nextRelative}`,
        );
      }
    }
  }
  await visit(sourceRoot, destination, '');
}

function compiledRuntimeFilter(relativePath, isDirectory) {
  const segments = relativePath.split('/');
  if (
    segments.some((segment) =>
      DEVELOPMENT_DIRECTORY_NAMES.has(segment.toLowerCase()),
    )
  ) {
    return false;
  }
  if (isDirectory) return true;
  return ['.js', '.json', '.ps1'].includes(extname(relativePath).toLowerCase());
}

function externalRuntimeFilter(relativePath, isDirectory) {
  const segments = relativePath.split('/');
  if (segments[0]?.toLowerCase() === 'node_modules') return false;
  if (
    segments.some((segment) =>
      DEVELOPMENT_DIRECTORY_NAMES.has(segment.toLowerCase()),
    )
  ) {
    return false;
  }
  if (isDirectory) return true;
  const lower = relativePath.toLowerCase();
  if (lower.endsWith('.md')) {
    const fileName = lower.split('/').at(-1) ?? '';
    return /^(readme|license|notice|third[_-]?party)/.test(fileName);
  }
  return !(
    lower.endsWith('.map') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.flow')
  );
}

async function resolveDependencyRoot(packageRoot, dependencyName) {
  const localCandidate = join(
    packageRoot,
    'node_modules',
    ...dependencyName.split('/'),
  );
  const candidate = await realpath(localCandidate).catch(() => null);
  if (candidate !== null) return candidate;
  let ancestor = packageRoot;
  for (;;) {
    if (basename(ancestor).toLowerCase() === 'node_modules') {
      const sibling = await realpath(
        join(ancestor, ...dependencyName.split('/')),
      ).catch(() => null);
      if (sibling !== null) return sibling;
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const workspaceCandidate = join(
    applicationRoot,
    'node_modules',
    ...dependencyName.split('/'),
  );
  const workspace = await realpath(workspaceCandidate).catch(() => null);
  if (workspace !== null) return workspace;
  throw new Error(`Production dependency ${dependencyName} is not installed.`);
}

async function copyProductionDependencyClosure(stagingRoot, packageJson) {
  const queue = Object.keys(packageJson.dependencies ?? {})
    .sort()
    .map((name) => ({
      name,
      parentRoot: applicationRoot,
      optional: false,
    }));
  const resolved = new Map();
  while (queue.length > 0) {
    const request = queue.shift();
    let packageRoot;
    try {
      packageRoot = await resolveDependencyRoot(
        request.parentRoot,
        request.name,
      );
    } catch (error) {
      if (request.optional) continue;
      throw error;
    }
    const dependencyPackageJson = JSON.parse(
      await readFile(join(packageRoot, 'package.json'), 'utf8'),
    );
    if (dependencyPackageJson.name !== request.name) {
      throw new Error(
        `Resolved dependency identity mismatch for ${request.name}.`,
      );
    }
    const previous = resolved.get(request.name);
    if (previous !== undefined) {
      if (previous.version !== dependencyPackageJson.version) {
        throw new Error(
          `Multiple production versions of ${request.name} require nested layout support.`,
        );
      }
      continue;
    }
    resolved.set(request.name, {
      root: packageRoot,
      version: dependencyPackageJson.version,
    });
    for (const name of Object.keys(
      dependencyPackageJson.dependencies ?? {},
    ).sort()) {
      queue.push({ name, parentRoot: packageRoot, optional: false });
    }
    for (const name of Object.keys(
      dependencyPackageJson.optionalDependencies ?? {},
    ).sort()) {
      queue.push({ name, parentRoot: packageRoot, optional: true });
    }
  }

  for (const [name, dependency] of [...resolved.entries()].sort(
    ([left], [right]) => left.localeCompare(right, 'en'),
  )) {
    const target = join(stagingRoot, 'node_modules', ...name.split('/'));
    if (name.startsWith(INTERNAL_PACKAGE_PREFIX)) {
      await mkdir(target, { recursive: true });
      await cp(
        join(dependency.root, 'package.json'),
        join(target, 'package.json'),
        {
          force: false,
          errorOnExist: true,
        },
      );
      await copyTree(
        join(dependency.root, 'dist'),
        join(target, 'dist'),
        compiledRuntimeFilter,
      );
    } else {
      await copyTree(dependency.root, target, externalRuntimeFilter);
    }
  }
}

async function copyBrowsers(browserSource, destination) {
  const entries = await readdir(await realpath(browserSource), {
    withFileTypes: true,
  });
  const selected = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^(chromium|chromium_headless_shell|ffmpeg|winldd)-[0-9]+$/.test(
          entry.name,
        ),
    )
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
  if (
    !selected.some((entry) => entry.name.startsWith('chromium-')) ||
    !selected.some((entry) => entry.name.startsWith('chromium_headless_shell-'))
  ) {
    throw new Error('The pinned Playwright Chromium payload is incomplete.');
  }
  await mkdir(destination, { recursive: true });
  for (const entry of selected) {
    await copyTree(
      join(browserSource, entry.name),
      join(destination, entry.name),
      () => true,
    );
  }
}

async function copyNodeRuntime(stagingRoot) {
  const expectedNodeVersion = (
    await readFile(join(repositoryRoot, '.node-version'), 'utf8')
  ).trim();
  if (
    process.platform !== 'win32' ||
    process.arch !== 'x64' ||
    process.version !== `v${expectedNodeVersion}`
  ) {
    throw new Error(
      `Windows x64 packaging requires Node ${expectedNodeVersion} on Windows x64.`,
    );
  }
  const runtimeRoot = join(stagingRoot, 'runtime');
  await mkdir(runtimeRoot, { recursive: true });
  await cp(process.execPath, join(runtimeRoot, 'node.exe'), {
    force: false,
    errorOnExist: true,
  });
  await cp(
    join(dirname(process.execPath), 'LICENSE'),
    join(runtimeRoot, 'LICENSE'),
    {
      force: false,
      errorOnExist: true,
    },
  );
}

async function copyWinSw(stagingRoot) {
  const source = join(
    applicationRoot,
    'windows',
    'vendor',
    'winsw-2.12.0',
    'WinSW.NET461.exe',
  );
  const bytes = await readFile(source);
  if (createHash('sha256').update(bytes).digest('hex') !== WIN_SW_SHA256) {
    throw new Error('The pinned WinSW checksum is invalid.');
  }
  const target = join(stagingRoot, 'windows', 'vendor', 'winsw-2.12.0');
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'WinSW.NET461.exe'), bytes, { flag: 'wx' });
  await cp(
    join(applicationRoot, 'windows', 'THIRD_PARTY_NOTICES.md'),
    join(stagingRoot, 'windows', 'THIRD_PARTY_NOTICES.md'),
    { force: false, errorOnExist: true },
  );
}

export async function stageWindowsX64Release(input) {
  const outputDirectory = resolve(input.outputDirectory);
  const identity = RunnerBuildIdentitySchema.parse(
    await readRegularJson(
      join(applicationRoot, 'dist', 'release', 'build-identity.json'),
    ),
  );
  if (
    identity.platform !== RUNNER_RELEASE_PLATFORM ||
    identity.architecture !== RUNNER_RELEASE_ARCHITECTURE
  ) {
    throw new Error('The embedded Runner build target is unsupported.');
  }
  const packageJson = JSON.parse(
    await readFile(join(applicationRoot, 'package.json'), 'utf8'),
  );
  if (packageJson.version !== identity.version) {
    throw new Error('The package and embedded Runner versions do not match.');
  }
  const archiveName = expectedRunnerArtifactFileName(
    identity.version,
    RUNNER_RELEASE_PLATFORM,
    RUNNER_RELEASE_ARCHITECTURE,
  );
  const stagingName = archiveName.slice(0, -4);
  const stagingRoot = join(outputDirectory, stagingName);
  if (relative(outputDirectory, stagingRoot).split(sep).includes('..')) {
    throw new Error('The release staging path is invalid.');
  }
  if ((await lstat(stagingRoot).catch(() => null)) !== null) {
    throw new Error('The immutable release staging directory already exists.');
  }
  await mkdir(stagingRoot, { recursive: false });
  await copyTree(
    join(applicationRoot, 'dist'),
    join(stagingRoot, 'dist'),
    compiledRuntimeFilter,
  );
  await copyProductionDependencyClosure(stagingRoot, packageJson);
  await copyNodeRuntime(stagingRoot);
  await copyBrowsers(input.browserSource, join(stagingRoot, 'browsers'));
  await copyWinSw(stagingRoot);
  await writeFile(
    join(stagingRoot, 'package.json'),
    `${JSON.stringify(sanitizedPackageJson(packageJson, identity), null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  await writeFile(
    join(stagingRoot, 'runner.cmd'),
    '@echo off\r\nsetlocal\r\nset "PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers"\r\n"%~dp0runtime\\node.exe" "%~dp0dist\\index.js" %*\r\n',
    { encoding: 'utf8', flag: 'wx' },
  );
  await inspectReleaseStaging(stagingRoot);
  return { identity, stagingRoot, archiveName };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseOptions(process.argv.slice(2), {
    '--output-dir': true,
    '--browser-source': true,
  });
  const result = await stageWindowsX64Release({
    outputDirectory: options['--output-dir'],
    browserSource: options['--browser-source'],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
