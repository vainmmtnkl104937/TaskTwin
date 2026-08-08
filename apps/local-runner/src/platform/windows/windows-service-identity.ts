import { LocalSecretStoreError } from '@tasktwin/local-secret-store';

export function runnerWindowsServiceName(runnerDeviceId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runnerDeviceId)) {
    throw new LocalSecretStoreError('NATIVE_PROTECTOR_BINDING_INVALID');
  }
  return `TaskTwinRunner_${runnerDeviceId.replaceAll('-', '')}`;
}
