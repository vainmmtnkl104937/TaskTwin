import { readFile } from 'node:fs/promises';

const typescriptConfigs = [
  'typescript/base.json',
  'typescript/browser.json',
  'typescript/nextjs.json',
  'typescript/node.json',
];

await Promise.all(
  typescriptConfigs.map(async (path) => {
    const contents = await readFile(
      new URL(`../${path}`, import.meta.url),
      'utf8',
    );
    JSON.parse(contents);
  }),
);

await Promise.all([
  import('../eslint/base.mjs'),
  import('../eslint/browser.mjs'),
  import('../eslint/node.mjs'),
]);

console.info('TaskTwin shared configuration is valid.');
