import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const onlyOnWindows = process.platform === 'win32' ? describe : describe.skip;

onlyOnWindows('WinSW adjacent activation layout', () => {
  it('loads a same-basename adjacent XML without an external config argument', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tasktwin-winsw-layout-'));
    try {
      const source = resolve(
        'windows',
        'vendor',
        'winsw-2.12.0',
        'WinSW.NET461.exe',
      );
      const executable = join(directory, 'TaskTwinWinSWLayoutProbe.exe');
      const xml = join(directory, 'TaskTwinWinSWLayoutProbe.xml');
      await copyFile(source, executable);
      await writeFile(
        xml,
        `<?xml version="1.0" encoding="utf-8"?>
<service>
  <id>TaskTwinWinSWLayoutProbe</id>
  <name>TaskTwin WinSW Layout Probe</name>
  <description>Read-only TaskTwin WinSW layout integration probe.</description>
  <executable>${process.execPath}</executable>
  <arguments>--version</arguments>
</service>
`,
        'utf8',
      );
      const result = await executeAllowFailure(executable, ['status']);
      expect(result.output).not.toContain('Unable to locate');
      expect(result.output).not.toContain('FileNotFoundException');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function executeAllowFailure(
  executable: string,
  args: readonly string[],
): Promise<{ readonly output: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      executable,
      [...args],
      { windowsHide: true, timeout: 15_000 },
      (_error, stdout, stderr) => {
        resolvePromise({
          output: `${stdout}${stderr}`,
        });
      },
    );
  });
}
