import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ProductSemVerSchema,
  RunnerBuildIdentitySchema,
} from '@tasktwin/runner-release';

import { parseOptions, readRegularJson } from './release-script-utils.mjs';

export async function validateRunnerTagVersion(input) {
  const match = /^runner-v(.+)$/.exec(input.tag);
  if (match === null) throw new Error('The Runner release tag is invalid.');
  const tagVersion = ProductSemVerSchema.parse(match[1]);
  const identity = RunnerBuildIdentitySchema.parse(
    await readRegularJson(input.buildIdentityPath),
  );
  if (
    tagVersion !== identity.version ||
    input.packageVersion !== identity.version
  ) {
    throw new Error(
      'The Runner tag, package, and embedded versions do not match.',
    );
  }
  return tagVersion;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseOptions(process.argv.slice(2), {
    '--tag': true,
    '--package-version': true,
    '--build-identity': true,
  });
  const version = await validateRunnerTagVersion({
    tag: options['--tag'],
    packageVersion: options['--package-version'],
    buildIdentityPath: resolve(options['--build-identity']),
  });
  process.stdout.write(`${version}\n`);
}
