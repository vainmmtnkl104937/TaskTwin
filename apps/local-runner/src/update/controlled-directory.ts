import { lstat, mkdir } from 'node:fs/promises';
import { parse, relative, resolve, sep } from 'node:path';

/**
 * Creates a directory one component at a time and rejects any existing link
 * in its ancestor chain. ProgramData ACLs and the update lease protect the
 * checked tree from replacement by another normal Runner process.
 */
export async function ensureControlledDirectory(path: string): Promise<void> {
  for (const component of pathComponents(path)) {
    const existing = await lstatOrNull(component);
    if (existing === null) {
      await mkdir(component, { recursive: false, mode: 0o700 }).catch(
        (error: unknown) =>
          isAlreadyExists(error) ? undefined : Promise.reject(error),
      );
    }
    await assertControlledDirectory(component);
  }
}

export async function assertControlledDirectoryChain(
  path: string,
): Promise<void> {
  for (const component of pathComponents(path)) {
    await assertControlledDirectory(component);
  }
}

/** Returns false only when an ordinary missing ancestor makes the path absent. */
export async function validateExistingControlledDirectoryChain(
  path: string,
): Promise<boolean> {
  for (const component of pathComponents(path)) {
    const existing = await lstatOrNull(component);
    if (existing === null) return false;
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error(
        'The Runner installation path contains a link or reparse point.',
      );
    }
  }
  return true;
}

async function assertControlledDirectory(path: string): Promise<void> {
  const existing = await lstat(path);
  if (!existing.isDirectory() || existing.isSymbolicLink()) {
    throw new Error(
      'The Runner installation path contains a link or reparse point.',
    );
  }
}

function pathComponents(path: string): string[] {
  const resolved = resolve(path);
  const root = parse(resolved).root;
  const components: string[] = [];
  let current = root;
  for (const component of relative(root, resolved)
    .split(sep)
    .filter((value) => value.length > 0)) {
    current = resolve(current, component);
    components.push(current);
  }
  return components;
}

function lstatOrNull(path: string) {
  return lstat(path).catch((error: unknown) =>
    isMissing(error) ? null : Promise.reject(error),
  );
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  );
}
