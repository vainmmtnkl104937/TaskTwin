import {
  InMemorySecretProvider,
  SecureRunInputError,
  type SecretLease,
  type SecretProvider,
  type SecureSecretRequirement,
} from '@tasktwin/secure-run-inputs';

export class InteractiveSecretProvider implements SecretProvider {
  constructor(private readonly timeoutMs = 120_000) {}

  isAvailable(): boolean {
    return process.stdin.isTTY === true && process.stdout.isTTY === true;
  }

  async acquire(
    requirements: readonly SecureSecretRequirement[],
    signal: AbortSignal,
  ): Promise<SecretLease> {
    if (!this.isAvailable()) {
      throw new SecureRunInputError('SECRET_UNAVAILABLE');
    }
    const values: Record<string, string> = {};
    try {
      for (const requirement of requirements) {
        values[requirement.secretName] = await this.readHidden(
          `Secret ${requirement.secretName}: `,
          signal,
        );
      }
      return await new InMemorySecretProvider(values).acquire(
        requirements,
        signal,
      );
    } finally {
      for (const name of Object.keys(values)) values[name] = '';
    }
  }

  private readHidden(prompt: string, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      let value = '';
      let settled = false;
      const stdin = process.stdin;
      const timeout = setTimeout(() => {
        finishError('SECRET_PROMPT_TIMEOUT');
      }, this.timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        stdin.off('data', onData);
        signal.removeEventListener('abort', onAbort);
        stdin.setRawMode(false);
        stdin.pause();
        process.stdout.write('\n');
      };
      const finishError = (
        code: 'SECRET_PROMPT_CANCELLED' | 'SECRET_PROMPT_TIMEOUT',
      ) => {
        if (settled) return;
        settled = true;
        value = '';
        cleanup();
        reject(new SecureRunInputError(code));
      };
      const onAbort = () => finishError('SECRET_PROMPT_CANCELLED');
      const onData = (chunk: Buffer) => {
        for (const byte of chunk) {
          if (byte === 3) {
            finishError('SECRET_PROMPT_CANCELLED');
            return;
          }
          if (byte === 13 || byte === 10) {
            if (settled) return;
            settled = true;
            const result = value;
            value = '';
            cleanup();
            resolve(result);
            return;
          }
          if (byte === 8 || byte === 127) {
            value = value.slice(0, -1);
          } else if (byte >= 32 && value.length < 4_096) {
            value += String.fromCharCode(byte);
          }
        }
      };
      if (signal.aborted) {
        finishError('SECRET_PROMPT_CANCELLED');
        return;
      }
      process.stdout.write(prompt);
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on('data', onData);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
