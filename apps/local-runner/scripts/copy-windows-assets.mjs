import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetDirectory = resolve(root, 'dist/platform/windows');
await mkdir(targetDirectory, { recursive: true });
await copyFile(
  resolve(root, 'src/platform/windows/windows-native-bridge.ps1'),
  resolve(targetDirectory, 'windows-native-bridge.ps1'),
);
await copyFile(
  resolve(root, 'src/platform/windows/windows-runner-installation-acl.ps1'),
  resolve(targetDirectory, 'windows-runner-installation-acl.ps1'),
);
const updateTargetDirectory = resolve(root, 'dist/update');
await mkdir(updateTargetDirectory, { recursive: true });
await copyFile(
  resolve(root, 'src/update/windows-release-archive.ps1'),
  resolve(updateTargetDirectory, 'windows-release-archive.ps1'),
);
