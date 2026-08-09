import { parseArgs } from 'node:util';

import type { RunnerUpdateController } from './update-controller.js';

export interface RunnerUpdateCliOutput {
  write(message: string): void;
}

export async function runUpdateCli(input: {
  readonly argv: string[];
  readonly output: RunnerUpdateCliOutput;
  readonly createController: (
    dataRoot: string | undefined,
  ) => RunnerUpdateController | Promise<RunnerUpdateController>;
}): Promise<number> {
  const operation = input.argv[1];
  if (
    operation === 'status' ||
    operation === 'rollback' ||
    operation === 'recover'
  ) {
    const parsed = parseArgs({
      args: input.argv.slice(2),
      options: { 'data-root': { type: 'string' } },
      strict: true,
    });
    const controller = await input.createController(parsed.values['data-root']);
    if (operation === 'status') {
      input.output.write(JSON.stringify(await controller.status()));
      return 0;
    }
    if (operation === 'rollback') {
      input.output.write(JSON.stringify(await controller.rollback()));
      return 0;
    }
    const recovered = await controller.recover();
    input.output.write(JSON.stringify({ recovered }));
    return 0;
  }
  if (operation === 'apply') {
    const parsed = parseArgs({
      args: input.argv.slice(2),
      options: {
        manifest: { type: 'string' },
        signature: { type: 'string' },
        artifact: { type: 'string' },
        'data-root': { type: 'string' },
      },
      strict: true,
    });
    const manifestPath = parsed.values.manifest;
    const signaturePath = parsed.values.signature;
    const artifactPath = parsed.values.artifact;
    if (
      manifestPath === undefined ||
      signaturePath === undefined ||
      artifactPath === undefined
    ) {
      throw new Error(
        'Usage: runner update apply --manifest <path> --signature <path> --artifact <path>',
      );
    }
    const controller = await input.createController(parsed.values['data-root']);
    input.output.write(
      JSON.stringify(
        await controller.apply({ manifestPath, signaturePath, artifactPath }),
      ),
    );
    return 0;
  }
  throw new Error('Unknown Runner update command.');
}
