import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import https from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const expected = 'b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f';
const url = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'windows/vendor/winsw-2.12.0');
const destination = resolve(directory, 'WinSW.NET461.exe');
const temporary = `${destination}.${randomUUID()}.tmp`;
await mkdir(directory, { recursive: true });

async function downloadPinnedArtifact(source, target, redirectCount) {
  const allowedHosts = new Set([
    'github.com',
    'objects.githubusercontent.com',
    'release-assets.githubusercontent.com',
  ]);
  if (!allowedHosts.has(source.hostname) || source.protocol !== 'https:') {
    throw new Error('The pinned WinSW download origin is invalid.');
  }
  await new Promise((resolveDownload, reject) => {
    const request = https.get(source, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        const location = response.headers.location;
        response.resume();
        if (location === undefined || redirectCount >= 5) {
          reject(new Error('The pinned WinSW redirect is invalid.'));
          return;
        }
        downloadPinnedArtifact(new URL(location, source), target, redirectCount + 1)
          .then(resolveDownload, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error('The pinned WinSW artifact is unavailable.'));
        return;
      }
      const output = createWriteStream(target, { flags: 'wx', mode: 0o700 });
      response.pipe(output);
      output.once('finish', () => output.close(resolveDownload));
      output.once('error', reject);
    });
    request.once('error', reject);
  });
}

try {
  await downloadPinnedArtifact(new URL(url), temporary, 0);
  const digest = createHash('sha256').update(await readFile(temporary)).digest('hex');
  if (digest !== expected) throw new Error('The pinned WinSW checksum is invalid.');
  await chmod(temporary, 0o700);
  await rename(temporary, destination);
} catch (error) {
  await unlink(temporary).catch(() => undefined);
  throw error;
}
