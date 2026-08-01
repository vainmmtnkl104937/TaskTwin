import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { describe, expect, it } from 'vitest';

import {
  SafeVerificationResultSchema,
  analyzeWorkflowVerifications,
  compareVerificationFieldValue,
  compareVerificationText,
  compareVerificationUrls,
  normalizeVerificationText,
  normalizeVerificationUrl,
  textMatchMode,
  urlMatchMode,
} from '../src/index.js';

function workflow(
  assertion: WorkflowDefinition['steps'][number] extends never
    ? never
    : Extract<
        WorkflowDefinition['steps'][number],
        { type: 'verify' }
      >['assertion'],
): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: 'verificationTest',
    version: 1,
    name: 'Verification test',
    status: 'draft',
    variables: [],
    steps: [
      {
        id: 'verifyOutcome',
        type: 'verify',
        name: 'Verify outcome',
        assertion,
        timeoutMs: 1_000,
      },
    ],
  };
}

describe('workflow verification', () => {
  it('matches URL origin while ignoring path, query and fragment', () => {
    expect(
      compareVerificationUrls(
        'https://example.com/actual?token=hidden#part',
        'https://example.com/expected?different=true#other',
        'origin',
      ),
    ).toBe(true);
  });

  it('matches origin and path while ignoring query and fragment', () => {
    expect(
      compareVerificationUrls(
        'https://example.com/result?a=1#one',
        'https://example.com/result?b=2#two',
        'origin_and_path',
      ),
    ).toBe(true);
    expect(
      compareVerificationUrls(
        'https://example.com/result',
        'https://example.com/other',
        'origin_and_path',
      ),
    ).toBe(false);
    expect(
      compareVerificationUrls(
        'https://other.example/result',
        'https://example.com/result',
        'origin',
      ),
    ).toBe(false);
  });

  it('rejects unsafe and credential-bearing URLs', () => {
    expect(normalizeVerificationUrl('javascript:alert(1)')).toEqual({
      ok: false,
      code: 'unsafe',
    });
    expect(normalizeVerificationUrl('https://user:pass@example.com/')).toEqual({
      ok: false,
      code: 'unsafe',
    });
  });

  it('normalizes and compares text deterministically', () => {
    expect(normalizeVerificationText('  Cafe\u0301\n  ready  ')).toBe(
      'Café ready',
    );
    expect(
      compareVerificationText(' Task   complete ', 'Task complete', 'exact'),
    ).toBe(true);
    expect(
      compareVerificationText('Task complete safely', 'complete', 'contains'),
    ).toBe(true);
    expect(compareVerificationText('Task failed', 'complete', 'contains')).toBe(
      false,
    );
  });

  it('compares field values exactly', () => {
    expect(compareVerificationFieldValue('42', 42)).toBe(true);
    expect(compareVerificationFieldValue('true', true)).toBe(true);
    expect(compareVerificationFieldValue('TaskTwin', 'tasktwin')).toBe(false);
  });

  it('normalizes canonical and compatible legacy modes', () => {
    const canonicalText = workflow({
      kind: 'text',
      locator: { kind: 'testId', value: 'result' },
      matchMode: 'exact',
      expected: { kind: 'literal', value: 'Done' },
    });
    const textStep = canonicalText.steps[0];
    expect(textStep?.type === 'verify' ? textMatchMode(textStep) : null).toBe(
      'exact',
    );
    const legacyUrl = workflow({
      kind: 'url',
      operator: 'equals',
      expected: { kind: 'literal', value: 'https://example.com/result' },
    });
    const urlStep = legacyUrl.steps[0];
    expect(urlStep?.type === 'verify' ? urlMatchMode(urlStep) : null).toBe(
      'origin_and_path',
    );
  });

  it('accepts visibility and checked rules', () => {
    for (const assertion of [
      {
        kind: 'visible' as const,
        locator: { kind: 'testId' as const, value: 'result' },
      },
      {
        kind: 'hidden' as const,
        locator: { kind: 'testId' as const, value: 'result' },
      },
      {
        kind: 'checked' as const,
        locator: { kind: 'label' as const, value: 'Confirm' },
        expected: true,
      },
      {
        kind: 'checked' as const,
        locator: { kind: 'label' as const, value: 'Confirm' },
        expected: false,
      },
    ]) {
      expect(analyzeWorkflowVerifications(workflow(assertion)).issues).toEqual(
        [],
      );
    }
  });

  it('rejects secret and file expectations', () => {
    const secret = workflow({
      kind: 'text',
      locator: { kind: 'testId', value: 'result' },
      matchMode: 'exact',
      expected: { kind: 'secret', secretName: 'privateValue' },
    });
    expect(analyzeWorkflowVerifications(secret).issues[0]?.code).toBe(
      'VERIFICATION_SECRET_EXPECTATION_FORBIDDEN',
    );

    const file: WorkflowDefinition = {
      ...secret,
      variables: [{ name: 'attachment', valueType: 'file', required: true }],
      steps: [
        {
          id: 'verify-result',
          type: 'verify',
          name: 'Verify result',
          assertion: {
            kind: 'text',
            locator: { kind: 'testId', value: 'result' },
            matchMode: 'exact',
            expected: { kind: 'variable', variableName: 'attachment' },
          },
        },
      ],
    };
    expect(analyzeWorkflowVerifications(file).issues[0]?.code).toBe(
      'VERIFICATION_FILE_EXPECTATION_FORBIDDEN',
    );
  });

  it('blocks unsupported legacy contains rules', () => {
    const analysis = analyzeWorkflowVerifications(
      workflow({
        kind: 'url',
        operator: 'contains',
        expected: { kind: 'literal', value: 'https://example.com/' },
      }),
    );
    expect(analysis.hasValidVerification).toBe(false);
    expect(analysis.issues[0]?.code).toBe(
      'VERIFICATION_LEGACY_OPERATOR_UNSUPPORTED',
    );
  });

  it('keeps safe results value-free and strict', () => {
    const result = SafeVerificationResultSchema.parse({
      schemaVersion: 1,
      kind: 'checked',
      outcome: 'matched',
      attemptCount: 1,
      durationMs: 4,
      observedState: 'checked',
    });
    expect(JSON.stringify(result)).not.toContain('expected');
    expect(JSON.stringify(result)).not.toContain('actual');
    expect(
      SafeVerificationResultSchema.safeParse({ ...result, actual: 'secret' })
        .success,
    ).toBe(false);
  });
});
