import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const MAXIMUM_SECRET_FILE_BYTES = 8_192;

function readBoundedSecretFile(path: string, variableName: string): string {
  let descriptor: number | undefined;
  try {
    const linkStatus = lstatSync(path);
    if (linkStatus.isSymbolicLink() || !linkStatus.isFile()) {
      throw new Error(`${variableName}_FILE must reference a regular file`);
    }
    if (linkStatus.size > MAXIMUM_SECRET_FILE_BYTES) {
      throw new Error(`${variableName}_FILE exceeds the safe size limit`);
    }

    descriptor = openSync(path, 'r');
    const status = fstatSync(descriptor);
    if (!status.isFile() || status.size > MAXIMUM_SECRET_FILE_BYTES) {
      throw new Error(`${variableName}_FILE is not a bounded regular file`);
    }
    const buffer = Buffer.alloc(status.size + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytesRead !== status.size) {
      throw new Error(`${variableName}_FILE changed while it was being read`);
    }
    return buffer
      .subarray(0, bytesRead)
      .toString('utf8')
      .replace(/[\r\n]+$/u, '');
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`${variableName}_FILE`)
    ) {
      throw error;
    }
    throw new Error(`${variableName}_FILE could not be read safely`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function getRequiredEnvironmentSecret(
  variableName: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const directValue = environment[variableName];
  const fileVariableName = `${variableName}_FILE`;
  const filePath = environment[fileVariableName];

  if (directValue !== undefined && filePath !== undefined) {
    throw new Error(
      `${variableName} and ${fileVariableName} are mutually exclusive`,
    );
  }
  const value =
    filePath === undefined
      ? directValue
      : readBoundedSecretFile(filePath, variableName);
  if (value === undefined || value.trim() === '') {
    throw new Error(`${variableName} or ${fileVariableName} is required`);
  }
  return value;
}

export function getRequiredDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const databaseUrl = getRequiredEnvironmentSecret('DATABASE_URL', environment);

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (!POSTGRES_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error('DATABASE_URL must use the postgresql protocol');
  }

  return databaseUrl;
}
