export class GoldenApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    const code = responseCode(body);
    super(
      `Golden-path API request failed with ${status}${code === null ? '' : ` (${code})`}.`,
    );
    this.name = 'GoldenApiError';
  }
}

function responseCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const code = record.code;
  if (typeof code !== 'string') return null;
  const issueCodes = safeIssueCodes(record.readiness);
  return issueCodes.length === 0 ? code : `${code}: ${issueCodes.join(', ')}`;
}

function safeIssueCodes(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [];
  }
  const issues = (value as Record<string, unknown>).issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue) => {
    if (typeof issue !== 'object' || issue === null || Array.isArray(issue)) {
      return [];
    }
    const code = (issue as Record<string, unknown>).code;
    return typeof code === 'string' ? [code] : [];
  });
}

export class GoldenApiClient {
  constructor(
    readonly origin: string,
    private readonly accessToken?: string,
  ) {}

  authenticated(accessToken: string): GoldenApiClient {
    return new GoldenApiClient(this.origin, accessToken);
  }

  get(path: string): Promise<unknown> {
    return this.request(path, { method: 'GET' });
  }

  post(path: string, body: unknown): Promise<unknown> {
    return this.request(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  patch(path: string, body: unknown): Promise<unknown> {
    return this.request(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.origin}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(this.accessToken === undefined
          ? {}
          : { authorization: `Bearer ${this.accessToken}` }),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text !== '') {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = null;
      }
    }
    if (!response.ok) throw new GoldenApiError(response.status, body);
    return body;
  }
}

export function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} was not an object.`);
  }
  return value as Record<string, unknown>;
}

export function stringField(
  value: Record<string, unknown>,
  key: string,
): string {
  const field = value[key];
  if (typeof field !== 'string') throw new Error(`${key} was not a string.`);
  return field;
}

export function numberField(
  value: Record<string, unknown>,
  key: string,
): number {
  const field = value[key];
  if (typeof field !== 'number') throw new Error(`${key} was not a number.`);
  return field;
}
