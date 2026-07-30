import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';

import {
  CreateDraftVersionCloneInputSchema,
  CreateDraftVersionCloneResultSchema,
  type CreateDraftVersionCloneResult,
} from './contracts.js';

export function createDraftVersionClone(
  input: unknown,
): CreateDraftVersionCloneResult {
  const parsed = CreateDraftVersionCloneInputSchema.safeParse(input);
  if (!parsed.success) {
    return CreateDraftVersionCloneResultSchema.parse({
      ok: false,
      error: {
        code: 'INVALID_CLONE_INPUT',
        message: 'The workflow version clone input is invalid.',
      },
    });
  }

  if (
    parsed.data.sourceStatus !== 'published' &&
    parsed.data.sourceStatus !== 'archived'
  ) {
    return CreateDraftVersionCloneResultSchema.parse({
      ok: false,
      error: {
        code: 'SOURCE_VERSION_NOT_CLONEABLE',
        message:
          'A new draft can be created only from a published or archived version.',
      },
    });
  }

  if (parsed.data.nextVersion <= parsed.data.sourceDefinition.version) {
    return CreateDraftVersionCloneResultSchema.parse({
      ok: false,
      error: {
        code: 'INVALID_NEXT_VERSION',
        message: 'The new workflow version must be greater than its source.',
      },
    });
  }

  const definition = WorkflowDefinitionSchema.parse({
    ...parsed.data.sourceDefinition,
    version: parsed.data.nextVersion,
    status: 'draft',
  });

  return CreateDraftVersionCloneResultSchema.parse({
    ok: true,
    definition,
    metadata: {
      version: parsed.data.nextVersion,
      revision: 1,
      status: 'draft',
      createdAt: parsed.data.createdAt,
    },
  });
}
