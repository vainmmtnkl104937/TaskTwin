import { LocalSecretStoreError } from '@tasktwin/local-secret-store';

export interface NoEchoPrompt {
  isAvailable(): boolean;
  read(prompt: string, signal: AbortSignal, maxCharacters?: number): Promise<string>;
}

export class TerminalNoEchoPrompt implements NoEchoPrompt {
  constructor(private readonly timeoutMs = 120_000) {}

  isAvailable(): boolean {
    return process.stdin.isTTY === true && process.stdout.isTTY === true;
  }

  read(prompt: string, signal: AbortSignal, maxCharacters = 4_096): Promise<string> {
    if (!this.isAvailable()) throw new LocalSecretStoreError('VAULT_UNAVAILABLE');
    return new Promise((resolve, reject) => {
      let value = '';
      let settled = false;
      const stdin = process.stdin;
      const timeout = setTimeout(() => finishError(), this.timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        stdin.off('data', onData);
        signal.removeEventListener('abort', onAbort);
        stdin.setRawMode(false);
        stdin.pause();
        process.stdout.write('\n');
      };
      const finishError = () => {
        if (settled) return;
        settled = true;
        value = '';
        cleanup();
        reject(new LocalSecretStoreError('VAULT_UNLOCK_FAILED'));
      };
      const onAbort = () => finishError();
      const onData = (chunk: Buffer) => {
        for (const byte of chunk) {
          if (byte === 3) return finishError();
          if (byte === 13 || byte === 10) {
            if (settled) return;
            settled = true;
            const result = value;
            value = '';
            cleanup();
            resolve(result);
            return;
          }
          if (byte === 8 || byte === 127) value = value.slice(0, -1);
          else if (byte >= 32 && value.length < maxCharacters) value += String.fromCharCode(byte);
        }
      };
      if (signal.aborted) return finishError();
      process.stdout.write(prompt);
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on('data', onData);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

export function passphraseBytes(value: string): Buffer {
  return Buffer.from(value, 'utf8');
}
