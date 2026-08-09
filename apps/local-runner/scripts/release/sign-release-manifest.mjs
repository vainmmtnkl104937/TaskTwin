import { createHash, createPrivateKey, sign } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ReleaseManifestSchema,
  ReleaseSignatureSchema,
  canonicalizeReleaseManifest,
} from '@tasktwin/runner-release';

import {
  parseOptions,
  readRegularJson,
  writeNewFile,
} from './release-script-utils.mjs';

export function createDetachedReleaseSignature(input) {
  const manifest = ReleaseManifestSchema.parse(input.manifest);
  const canonicalManifest = canonicalizeReleaseManifest(manifest);
  if (manifest.signingKeyId !== input.keyId) {
    throw new Error('The signing key ID does not match the release manifest.');
  }
  const signature = sign(
    null,
    Buffer.from(canonicalManifest, 'utf8'),
    input.privateKey,
  );
  return ReleaseSignatureSchema.parse({
    schemaVersion: 1,
    algorithm: 'Ed25519',
    keyId: input.keyId,
    manifestSha256: createHash('sha256')
      .update(canonicalManifest, 'utf8')
      .digest('hex'),
    signature: signature.toString('base64url'),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseOptions(process.argv.slice(2), {
    '--manifest': true,
    '--key-id': true,
    '--output': true,
  });
  const encodedPrivateKey =
    process.env['TASKTWIN_RUNNER_RELEASE_SIGNING_KEY_PKCS8_BASE64'];
  if (encodedPrivateKey === undefined || encodedPrivateKey.length > 16 * 1024) {
    throw new Error('The release signing credential is unavailable.');
  }
  const privateKeyBytes = Buffer.from(encodedPrivateKey, 'base64');
  try {
    const privateKey = createPrivateKey({
      key: privateKeyBytes,
      format: 'der',
      type: 'pkcs8',
    });
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('The release signing credential algorithm is invalid.');
    }
    const manifest = await readRegularJson(resolve(options['--manifest']));
    const signature = createDetachedReleaseSignature({
      manifest,
      keyId: options['--key-id'],
      privateKey,
    });
    await writeNewFile(
      resolve(options['--output']),
      `${JSON.stringify(signature)}\n`,
    );
    process.stdout.write(`${signature.manifestSha256}\n`);
  } finally {
    privateKeyBytes.fill(0);
    delete process.env['TASKTWIN_RUNNER_RELEASE_SIGNING_KEY_PKCS8_BASE64'];
  }
}
