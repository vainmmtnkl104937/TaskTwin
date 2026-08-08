import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE_EXECUTION_POLICY } from '@tasktwin/workflow-policy';
import type { WorkflowDefinition } from '@tasktwin/workflow-schema';

import { analyzeScheduleCreationReadiness } from '../src/index.js';

const workspaceId = '2a0c786a-3234-42f0-a3bd-b6d7d76dce1f';
const digest = 'a'.repeat(64);

function workflow(value: { kind: 'secret'; secretName: string } = {
  kind: 'secret',
  secretName: 'LOGIN_PASSWORD',
}): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: 'scheduled-secret-workflow',
    version: 1,
    name: 'Scheduled secret workflow',
    status: 'published',
    variables: [],
    steps: [{
      id: 'fill-password',
      type: 'fill',
      name: 'Fill password',
      locator: { kind: 'label', value: 'Password' },
      value,
    }],
  };
}

function readiness(localSecrets: {
  capabilityAvailable: boolean;
  status: 'ready' | 'locked' | 'unavailable' | 'corrupted';
  synchronized: boolean;
  aliases: string[];
}) {
  return analyzeScheduleCreationReadiness({
    workflowVersionStatus: 'published',
    workflowDefinition: workflow(),
    runnerWorkspaceId: workspaceId,
    targetWorkspaceId: workspaceId,
    runnerRevokedAt: null,
    executionPolicy: DEFAULT_WORKSPACE_EXECUTION_POLICY,
    executionPolicyDigest: digest,
    workflowDigest: digest,
    localSecrets,
  });
}

describe('scheduled local-secret readiness', () => {
  it('accepts a published secret workflow only with synchronized alias inventory', () => {
    expect(readiness({ capabilityAvailable: true, status: 'ready',
      synchronized: true, aliases: ['LOGIN_PASSWORD'] })).toMatchObject({ ready: true });
  });

  it('rejects locked stores and missing aliases with stable safe issues', () => {
    expect(readiness({ capabilityAvailable: true, status: 'locked',
      synchronized: true, aliases: ['LOGIN_PASSWORD'] }).issues).toContainEqual(
        expect.objectContaining({ code: 'LOCAL_SECRET_STORE_NOT_READY' }),
      );
    expect(readiness({ capabilityAvailable: true, status: 'ready',
      synchronized: true, aliases: [] }).issues).toContainEqual(
        expect.objectContaining({ code: 'LOCAL_SECRET_ALIAS_MISSING' }),
      );
  });
});
