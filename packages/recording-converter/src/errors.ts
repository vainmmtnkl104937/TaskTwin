import type { ConversionIssue } from './contracts.js';

export class RecordingConversionInputError extends Error {
  constructor(public readonly issues: readonly ConversionIssue[]) {
    super('The source recording is invalid for conversion.');
    this.name = 'RecordingConversionInputError';
  }
}
