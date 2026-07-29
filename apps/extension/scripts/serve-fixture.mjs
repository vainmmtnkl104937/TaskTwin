/* global process */

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const host = '127.0.0.1';
const port = 4176;
const fixtureUrl = new URL('../fixture/index.html', import.meta.url);

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' || !['/', '/index.html'].includes(request.url)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  try {
    const fixture = await readFile(fixtureUrl);
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
    });
    response.end(fixture);
  } catch {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Fixture unavailable');
  }
});

server.listen(port, host, () => {
  process.stdout.write(
    `TaskTwin recorder fixture listening on port ${port}.\n`,
  );
});
