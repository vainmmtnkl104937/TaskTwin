export async function waitFor<T>(input: {
  readonly description: string;
  readonly inspect: () => Promise<T | null>;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}): Promise<T> {
  const deadline = Date.now() + (input.timeoutMs ?? 20_000);
  while (Date.now() < deadline) {
    const result = await input.inspect();
    if (result !== null) return result;
    await delay(input.intervalMs ?? 50);
  }
  throw new Error(`Timed out waiting for ${input.description}.`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
