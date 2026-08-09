export async function bootstrapRunner(input: {
  argv: string[];
  configureBrowserPath(): Promise<void>;
  loadCli(): Promise<{
    runCli(argv: string[]): Promise<number>;
  }>;
}): Promise<number> {
  await input.configureBrowserPath();
  const { runCli } = await input.loadCli();
  return runCli(input.argv);
}
