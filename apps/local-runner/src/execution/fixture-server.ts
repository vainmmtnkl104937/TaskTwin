import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';

const HOST = '127.0.0.1';
const FIXTURE_FILE = new URL(
  '../../fixtures/execution/index.html',
  import.meta.url,
);

export interface RunningFixtureServer {
  readonly origin: string;
  completed(): boolean;
  close(): Promise<void>;
}

export async function startFixtureServer(
  port = 0,
): Promise<RunningFixtureServer> {
  let completed = false;
  let repaired = false;
  const html = await readFile(FIXTURE_FILE);
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${HOST}`);
    if (
      request.method === 'GET' &&
      (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html')
    ) {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
      });
      response.end(html);
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/complete') {
      completed = true;
      response.writeHead(204, { 'cache-control': 'no-store' });
      response.end();
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/repair') {
      repaired = true;
      response.writeHead(204, { 'cache-control': 'no-store' });
      response.end();
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/state') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      });
      response.end(JSON.stringify({ completed, repaired }));
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });

  await listen(server, port);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await close(server);
    throw new Error('The Local Runner fixture server could not start.');
  }
  return {
    origin: `http://${HOST}:${address.port}`,
    completed: () => completed,
    close: () => close(server),
  };
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}
