import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, writeFile } from 'node:fs/promises';

export function parseOptions(argv, definitions) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!(name in definitions)) throw new Error(`Unknown option: ${name}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Option ${name} requires a value.`);
    }
    if (name in values) throw new Error(`Option ${name} was repeated.`);
    values[name] = value;
    index += 1;
  }
  for (const [name, required] of Object.entries(definitions)) {
    if (required && !(name in values))
      throw new Error(`Option ${name} is required.`);
  }
  return values;
}

export async function readRegularJson(path, maximumBytes = 256 * 1024) {
  const file = await lstat(path);
  if (
    !file.isFile() ||
    file.isSymbolicLink() ||
    file.size < 1 ||
    file.size > maximumBytes
  ) {
    throw new Error('Release metadata must be a bounded regular file.');
  }
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function writeNewFile(path, contents) {
  await writeFile(path, contents, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}
