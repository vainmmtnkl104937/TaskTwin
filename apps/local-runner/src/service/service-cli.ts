import type { RunnerCredentialStore } from '../credential-store.js';
import type { RunnerOutput } from '../runner-service.js';
import type { WindowsRunnerServiceManager } from '../platform/windows/windows-service-manager.js';

export async function runServiceCli(input: {
  args: string[];
  credentials: RunnerCredentialStore;
  manager: WindowsRunnerServiceManager;
  output: RunnerOutput;
}): Promise<number> {
  const command = input.args[0] ?? 'status';
  if (input.args.length !== 1) {
    throw new Error('The service command accepts exactly one operation.');
  }
  const credential = await input.credentials.load();
  if (credential === null) throw new Error('The Local Runner must be paired first.');
  switch (command) {
    case 'install':
      await input.manager.install(credential.runnerDeviceId);
      input.output.write('TaskTwin Local Runner service installed for automatic startup.');
      return 0;
    case 'status': {
      const status = await input.manager.status(credential.runnerDeviceId);
      input.output.write(`TaskTwin Local Runner service status: ${status}.`);
      return 0;
    }
    case 'start':
      await input.manager.start(credential.runnerDeviceId);
      input.output.write('TaskTwin Local Runner service start requested.');
      return 0;
    case 'stop':
      await input.manager.stop(credential.runnerDeviceId);
      input.output.write('TaskTwin Local Runner service stop completed.');
      return 0;
    case 'restart':
      await input.manager.restart(credential.runnerDeviceId);
      input.output.write('TaskTwin Local Runner service restart completed.');
      return 0;
    case 'uninstall':
      await input.manager.uninstall(credential.runnerDeviceId);
      input.output.write('TaskTwin Local Runner service uninstalled; Runner data was preserved.');
      return 0;
    default:
      throw new Error('Unknown service command.');
  }
}
