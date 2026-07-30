import { runCli } from './cli.js';

void runCli(process.argv.slice(2)).catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : 'The Local Runner could not complete the command.';
  console.error(message);
  process.exitCode = 1;
});
