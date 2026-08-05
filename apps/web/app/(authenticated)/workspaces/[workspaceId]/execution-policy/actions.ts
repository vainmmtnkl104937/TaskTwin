'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { WorkspaceExecutionPolicyDefinitionSchema } from '@tasktwin/workflow-policy';

import { getAccessToken } from '@/lib/server/auth-session';
import {
  createExecutionPolicyVersion,
  getExecutionPolicy,
} from '@/lib/server/control-plane';

function originPatterns(value: FormDataEntryValue | null) {
  return String(value ?? '')
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((origin) =>
      origin.startsWith('*.')
        ? {
            kind: 'https_subdomains' as const,
            patternVersion: 1 as const,
            domain: origin.slice(2),
            includeApex: false,
          }
        : { kind: 'exact' as const, origin },
    );
}

export async function updateExecutionPolicy(formData: FormData): Promise<void> {
  const token = await getAccessToken();
  if (token === null) redirect('/login');
  const workspaceId = String(formData.get('workspaceId') ?? '');
  const expectedActiveRevision = Number(formData.get('expectedActiveRevision'));
  const current = await getExecutionPolicy(token, workspaceId);
  const definition = WorkspaceExecutionPolicyDefinitionSchema.parse({
    ...current.active.definition,
    network: {
      mode: formData.get('networkMode'),
      allowedOrigins: originPatterns(formData.get('allowedOrigins')),
      blockedOrigins: originPatterns(formData.get('blockedOrigins')),
      allowLoopbackHttp: formData.get('allowLoopbackHttp') === 'on',
    },
    unknownActionRisk: formData.get('unknownActionRisk'),
    approval: {
      threshold: formData.get('approvalThreshold'),
      criticalActionBehavior: formData.get('criticalActionBehavior'),
    },
  });
  await createExecutionPolicyVersion(token, workspaceId, {
    clientVersionId: randomUUID(),
    expectedActiveRevision,
    definition,
  });
  revalidatePath(`/workspaces/${workspaceId}/execution-policy`);
}
