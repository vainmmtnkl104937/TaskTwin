import { SetMetadata } from '@nestjs/common';

export const ORGANIZATION_RESOURCE_METADATA = 'tasktwin:organization-resource';

export type OrganizationResourceKind =
  'workspace' | 'recordingSession' | 'workflowVersion';

export interface OrganizationResourceMetadata {
  kind: OrganizationResourceKind;
  parameterName: string;
}

export const ResolveOrganizationResource = (
  kind: OrganizationResourceKind,
  parameterName: string,
): MethodDecorator =>
  SetMetadata(ORGANIZATION_RESOURCE_METADATA, {
    kind,
    parameterName,
  } satisfies OrganizationResourceMetadata);
