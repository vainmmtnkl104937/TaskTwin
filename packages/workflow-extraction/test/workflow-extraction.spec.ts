import { describe, expect, it } from 'vitest';

import {
  SafeWorkflowOutputSummarySchema,
  analyzeWorkflowExtraction,
} from '../src/index.js';

function workflow(steps: unknown[]) {
  return {
    schemaVersion: 1,
    workflowId: 'extractionWorkflow',
    version: 1,
    name: 'Extraction workflow',
    status: 'draft',
    variables: [],
    steps,
  };
}

const extractString = {
  id: 'extractCustomerId',
  type: 'extract',
  name: 'Extract customer ID',
  locator: { kind: 'testId', value: 'customer-id' },
  source: { kind: 'text' },
  outputName: 'customerId',
};

const fillFromOutput = {
  id: 'fillCustomerId',
  type: 'fill',
  name: 'Fill customer ID',
  locator: { kind: 'label', value: 'Customer ID' },
  value: { kind: 'output', outputName: 'customerId' },
};

describe('workflow extraction analysis', () => {
  it('accepts a valid producer before its compatible consumer', () => {
    const analysis = analyzeWorkflowExtraction(
      workflow([extractString, fillFromOutput]),
    );
    expect(analysis.hasBlockingIssues).toBe(false);
    expect(analysis.outputs).toHaveLength(1);
    expect(analysis.usages).toHaveLength(1);
  });

  it('rejects a reference before its producer', () => {
    const analysis = analyzeWorkflowExtraction(
      workflow([fillFromOutput, extractString]),
    );
    expect(analysis.issues.map((issue) => issue.code)).toContain(
      'OUTPUT_REFERENCE_BEFORE_PRODUCER',
    );
  });

  it('rejects an unknown output reference', () => {
    const analysis = analyzeWorkflowExtraction(workflow([fillFromOutput]));
    expect(analysis.issues.map((issue) => issue.code)).toContain(
      'UNKNOWN_OUTPUT_REFERENCE',
    );
  });

  it('rejects duplicate output names deterministically', () => {
    const analysis = analyzeWorkflowExtraction(
      workflow([
        extractString,
        { ...extractString, id: 'extractAgain' },
        fillFromOutput,
      ]),
    );
    expect(analysis.issues.map((issue) => issue.code)).toContain(
      'DUPLICATE_OUTPUT_NAME',
    );
    expect(analysis.issues).toEqual(
      [...analysis.issues].sort((left, right) => {
        const index =
          (left.stepIndex ?? Number.MAX_SAFE_INTEGER) -
          (right.stepIndex ?? Number.MAX_SAFE_INTEGER);
        return (
          index ||
          JSON.stringify(left.path).localeCompare(JSON.stringify(right.path)) ||
          left.code.localeCompare(right.code) ||
          (left.outputName ?? '').localeCompare(right.outputName ?? '')
        );
      }),
    );
  });

  it('warns when an output is unused', () => {
    const analysis = analyzeWorkflowExtraction(workflow([extractString]));
    expect(analysis.issues).toContainEqual(
      expect.objectContaining({ code: 'UNUSED_OUTPUT', severity: 'warning' }),
    );
  });

  it('rejects incompatible boolean output and output Navigate', () => {
    const checked = {
      ...extractString,
      source: { kind: 'checked' },
      outputName: 'selected',
    };
    const fill = {
      ...fillFromOutput,
      value: { kind: 'output', outputName: 'selected' },
    };
    const navigate = {
      id: 'navigateFromOutput',
      type: 'navigate',
      name: 'Navigate from output',
      url: { kind: 'output', outputName: 'selected' },
    };
    const analysis = analyzeWorkflowExtraction(
      workflow([checked, fill, navigate]),
    );
    expect(analysis.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'OUTPUT_TYPE_INCOMPATIBLE',
        'OUTPUT_NAVIGATE_FORBIDDEN',
      ]),
    );
  });

  it('keeps safe summaries free of values, lengths and hashes', () => {
    const summary = SafeWorkflowOutputSummarySchema.parse({
      outputName: 'customerId',
      outputType: 'string',
      producerStepId: 'extractCustomerId',
      status: 'produced',
    });
    expect(JSON.stringify(summary)).not.toMatch(/value|length|hash/i);
  });
});
