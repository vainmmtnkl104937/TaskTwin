import {
  PlaintextRunInputPayloadSchema,
  RunInputAdditionalAuthenticatedDataSchema,
  SecureRunInputEnvelopeSchema,
  type PlaintextRunInputPayload,
  type RunInputAdditionalAuthenticatedData,
  type SecureRunInputEnvelope,
} from './contracts.js';
import { SecureRunInputError } from './errors.js';

export function assertEnvelopeBinding(
  envelopeInput: unknown,
  aadInput: unknown,
  now: Date,
): {
  envelope: SecureRunInputEnvelope;
  aad: RunInputAdditionalAuthenticatedData;
} {
  const envelope = SecureRunInputEnvelopeSchema.safeParse(envelopeInput);
  const aad = RunInputAdditionalAuthenticatedDataSchema.safeParse(aadInput);
  if (!envelope.success || !aad.success) {
    throw new SecureRunInputError('INVALID_SECURE_INPUT');
  }
  if (Date.parse(aad.data.expiresAt) <= now.getTime()) {
    throw new SecureRunInputError('PREPARATION_EXPIRED');
  }
  if (
    envelope.data.preparationId !== aad.data.preparationId ||
    envelope.data.workflowRunId !== aad.data.workflowRunId ||
    envelope.data.keyId !== aad.data.keyId ||
    envelope.data.expiresAt !== aad.data.expiresAt
  ) {
    throw new SecureRunInputError('ENVELOPE_BINDING_INVALID');
  }
  return { envelope: envelope.data, aad: aad.data };
}

export function assertPlaintextPayloadBinding(
  payloadInput: unknown,
  aadInput: unknown,
  now: Date,
): PlaintextRunInputPayload {
  const payload = PlaintextRunInputPayloadSchema.safeParse(payloadInput);
  const aad = RunInputAdditionalAuthenticatedDataSchema.safeParse(aadInput);
  if (!payload.success || !aad.success) {
    throw new SecureRunInputError('RUNTIME_INPUTS_INVALID');
  }
  if (Date.parse(payload.data.expiresAt) <= now.getTime()) {
    throw new SecureRunInputError('PREPARATION_EXPIRED');
  }
  if (
    payload.data.preparationId !== aad.data.preparationId ||
    payload.data.workflowRunId !== aad.data.workflowRunId ||
    payload.data.workflowVersionId !== aad.data.workflowVersionId ||
    payload.data.runnerDeviceId !== aad.data.runnerDeviceId ||
    payload.data.keyId !== aad.data.keyId ||
    payload.data.expiresAt !== aad.data.expiresAt
  ) {
    throw new SecureRunInputError('ENVELOPE_BINDING_INVALID');
  }
  return payload.data;
}
