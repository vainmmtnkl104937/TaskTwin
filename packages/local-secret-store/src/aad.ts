import {
  LocalSecretMasterKeyAadSchema,
  LocalSecretRecordAadSchema,
  type LocalSecretMasterKeyAad,
  type LocalSecretRecordAad,
} from './contracts.js';
import { serializeLocalSecretCanonicalJson } from './canonical-json.js';

export function encodeLocalSecretRecordAad(input: unknown): string {
  return serializeLocalSecretCanonicalJson(LocalSecretRecordAadSchema.parse(input));
}

export function encodeLocalSecretMasterKeyAad(input: unknown): string {
  return serializeLocalSecretCanonicalJson(LocalSecretMasterKeyAadSchema.parse(input));
}

export function buildLocalSecretRecordAad(
  input: LocalSecretRecordAad,
): LocalSecretRecordAad {
  return LocalSecretRecordAadSchema.parse(input);
}

export function buildLocalSecretMasterKeyAad(
  input: LocalSecretMasterKeyAad,
): LocalSecretMasterKeyAad {
  return LocalSecretMasterKeyAadSchema.parse(input);
}
