import { bootstrapRunner } from './bootstrap.js';
import { configurePackagedBrowserPath } from './release/runtime-layout.js';

void bootstrapRunner({
  argv: process.argv.slice(2),
  configureBrowserPath: configurePackagedBrowserPath,
  loadCli: () => import('./cli.js'),
})
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : 'The Local Runner could not complete the command.';
    console.error(message);
    process.exitCode = 1;
  });
