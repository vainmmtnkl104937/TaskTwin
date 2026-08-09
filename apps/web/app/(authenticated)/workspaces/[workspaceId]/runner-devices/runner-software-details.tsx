type RunnerCompatibilityStatus =
  'compatible' | 'update_recommended' | 'update_required' | 'unsupported';

interface RunnerSoftwareDetailsDevice {
  metadata: {
    platform: string;
    architecture: string;
    runnerVersion: string;
  };
  softwareIdentity?:
    | {
        version: string;
        runnerProtocolVersion: number;
        workflowSchemaVersion: number;
        localStateSchemaVersion: number;
        platform: string;
        architecture: string;
      }
    | null
    | undefined;
  compatibility?:
    | {
        status: RunnerCompatibilityStatus;
      }
    | undefined;
}

export function RunnerSoftwareDetails({
  device,
}: {
  device: RunnerSoftwareDetailsDevice;
}) {
  const identity = device.softwareIdentity ?? null;
  const compatibilityStatus = device.compatibility?.status ?? 'update_required';
  const target = identity
    ? `${identity.platform} / ${identity.architecture}`
    : `${device.metadata.platform} / ${device.metadata.architecture}`;

  return (
    <section aria-label="Runner software identity">
      <h3>Software</h3>
      <dl>
        <div>
          <dt>Installed Runner version</dt>
          <dd>{identity?.version ?? device.metadata.runnerVersion}</dd>
        </div>
        <div>
          <dt>Platform</dt>
          <dd>{target}</dd>
        </div>
        <div>
          <dt>Compatibility</dt>
          <dd>{compatibilityLabel(compatibilityStatus)}</dd>
        </div>
        <div>
          <dt>Runner protocol</dt>
          <dd>{identity?.runnerProtocolVersion ?? 'Not reported'}</dd>
        </div>
        <div>
          <dt>Workflow schema</dt>
          <dd>{identity?.workflowSchemaVersion ?? 'Not reported'}</dd>
        </div>
        <div>
          <dt>Local-state schema</dt>
          <dd>{identity?.localStateSchemaVersion ?? 'Not reported'}</dd>
        </div>
      </dl>
      {compatibilityStatus === 'update_required' ? (
        <p className="error-message" role="status">
          Runner update required. New workflow jobs are blocked until this
          Runner is manually updated.
        </p>
      ) : null}
      {compatibilityStatus === 'unsupported' ? (
        <p className="error-message" role="status">
          Unsupported Runner. New workflow jobs are blocked because this
          software identity is incompatible with the Control Plane.
        </p>
      ) : null}
    </section>
  );
}

function compatibilityLabel(status: RunnerCompatibilityStatus): string {
  switch (status) {
    case 'compatible':
      return 'Compatible';
    case 'update_recommended':
      return 'Update recommended';
    case 'update_required':
      return 'Update required';
    case 'unsupported':
      return 'Unsupported';
  }
}
