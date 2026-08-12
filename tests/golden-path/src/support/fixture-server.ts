import { createServer, type IncomingMessage, type Server } from 'node:http';

const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 8_192;

export interface FixtureSnapshot {
  readonly submitted: boolean;
  readonly runtimeMatched: boolean;
  readonly secretMatched: boolean;
  readonly repairCompleted: boolean;
  readonly submitCount: number;
}

export interface GoldenFixtureServer {
  readonly origin: string;
  expectValues(runtimeValue: string | null, secretValue: string): void;
  allowRepair(): void;
  reset(): void;
  snapshot(): FixtureSnapshot;
  close(): Promise<void>;
}

interface MutableState {
  expectedRuntime: string | null;
  expectedSecret: string;
  repairAvailable: boolean;
  submitted: boolean;
  runtimeMatched: boolean;
  secretMatched: boolean;
  repairCompleted: boolean;
  submitCount: number;
}

export async function startGoldenFixtureServer(): Promise<GoldenFixtureServer> {
  const state: MutableState = initialState();
  const server = createServer((request, response) => {
    void handle(request, response, state).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await close(server);
    throw new Error('The golden-path fixture did not bind to loopback.');
  }
  return {
    origin: `http://${HOST}:${address.port}`,
    expectValues(runtimeValue, secretValue) {
      state.expectedRuntime = runtimeValue;
      state.expectedSecret = secretValue;
    },
    allowRepair() {
      state.repairAvailable = true;
    },
    reset() {
      Object.assign(state, initialState());
    },
    snapshot: () => ({
      submitted: state.submitted,
      runtimeMatched: state.runtimeMatched,
      secretMatched: state.secretMatched,
      repairCompleted: state.repairCompleted,
      submitCount: state.submitCount,
    }),
    close: () => close(server),
  };
}

function initialState(): MutableState {
  return {
    expectedRuntime: null,
    expectedSecret: '',
    repairAvailable: false,
    submitted: false,
    runtimeMatched: false,
    secretMatched: false,
    repairCompleted: false,
    submitCount: 0,
  };
}

async function handle(
  request: IncomingMessage,
  response: import('node:http').ServerResponse,
  state: MutableState,
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${HOST}`);
  if (request.method === 'GET' && url.pathname === '/') {
    respond(response, 200, 'text/html; charset=utf-8', FIXTURE_HTML);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/repair-state') {
    respondJson(response, { available: state.repairAvailable });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/state') {
    respondJson(response, {
      submitted: state.submitted,
      runtimeMatched: state.runtimeMatched,
      secretMatched: state.secretMatched,
      repairCompleted: state.repairCompleted,
      submitCount: state.submitCount,
    });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/submit') {
    const body = await readJsonBody(request);
    const runtime = typeof body.runtime === 'string' ? body.runtime : null;
    const secret = typeof body.secret === 'string' ? body.secret : null;
    state.runtimeMatched =
      state.expectedRuntime === null || runtime === state.expectedRuntime;
    state.secretMatched = secret === state.expectedSecret;
    state.submitted = state.runtimeMatched && state.secretMatched;
    state.submitCount += 1;
    respondJson(response, { accepted: state.submitted });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/repair-complete') {
    state.repairCompleted = state.repairAvailable;
    respondJson(response, { accepted: state.repairCompleted });
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) throw new Error('Fixture body is too large.');
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Fixture body is invalid.');
  }
  return parsed as Record<string, unknown>;
}

function respondJson(
  response: import('node:http').ServerResponse,
  value: Record<string, unknown>,
): void {
  respond(
    response,
    200,
    'application/json; charset=utf-8',
    JSON.stringify(value),
  );
}

function respond(
  response: import('node:http').ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': contentType,
  });
  response.end(body);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>TaskTwin Golden Fixture</title></head>
  <body>
    <button type="button" data-testid="record-save" id="open-form">Open fixture form</button>
    <form id="fixture-form" hidden>
      <label>Email address <input data-testid="record-email" name="contactEmail" type="email"></label>
      <label>Password <input data-testid="record-password" name="accountPassword" type="password"></label>
      <span data-testid="ephemeral-output">GOLDEN_EPHEMERAL_OUTPUT</span>
      <button type="submit" data-testid="submit-fixture">Submit fixture</button>
    </form>
    <section id="repair-zone"></section>
    <p data-testid="final-result"></p>
    <script>
      const form = document.querySelector('#fixture-form');
      const result = document.querySelector('[data-testid="final-result"]');
      document.querySelector('[data-testid="record-save"]').addEventListener('click', () => { form.hidden = false; });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const response = await fetch('/submit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            runtime: form.elements.contactEmail.value,
            secret: form.elements.accountPassword.value,
          }),
        });
        const body = await response.json();
        result.textContent = body.accepted ? 'Fixture completed' : 'Fixture rejected';
      });
      async function refreshRepair() {
        const body = await fetch('/repair-state', { cache: 'no-store' }).then((response) => response.json());
        const zone = document.querySelector('#repair-zone');
        if (body.available && !zone.querySelector('[data-testid="repair-target"]')) {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.testid = 'repair-target';
          button.textContent = 'Complete repaired step';
          button.addEventListener('click', async () => {
            await fetch('/repair-complete', { method: 'POST' });
            result.textContent = 'Repair completed';
          });
          zone.append(button);
        }
      }
      setInterval(() => { void refreshRepair(); }, 50);
      void refreshRepair();
    </script>
  </body>
</html>`;
