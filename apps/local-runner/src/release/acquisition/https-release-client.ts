import { request as httpsRequest, type RequestOptions } from 'node:https';

import {
  RunnerAcquisitionError,
  type ReleaseAcquisitionTimeouts,
} from '@tasktwin/runner-acquisition';

export interface ReleaseHttpResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export interface ReleaseHttpRequest {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly maximumBytes: number;
  readonly maximumExceededCode:
    'acquisition_metadata_too_large' | 'acquisition_artifact_too_large';
  readonly totalTimeoutMilliseconds: number;
  readonly timeouts: ReleaseAcquisitionTimeouts;
  readonly onResponse: (response: ReleaseHttpResponse) => void | Promise<void>;
  readonly onChunk: (chunk: Uint8Array) => void | Promise<void>;
}

export interface ReleaseHttpClient {
  request(input: ReleaseHttpRequest): Promise<ReleaseHttpResponse>;
}

type HttpsRequest = typeof httpsRequest;

export class NodeHttpsReleaseClient implements ReleaseHttpClient {
  constructor(
    private readonly requestImplementation: HttpsRequest = httpsRequest,
  ) {}

  request(input: ReleaseHttpRequest): Promise<ReleaseHttpResponse> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let receivedBytes = 0;
      let readTimer: ReturnType<typeof setTimeout> | null = null;
      let connectTimer: ReturnType<typeof setTimeout> | null = null;
      let totalTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        if (connectTimer !== null) clearTimeout(connectTimer);
        if (totalTimer !== null) clearTimeout(totalTimer);
        if (readTimer !== null) clearTimeout(readTimer);
        operation();
      };
      const fail = (error: unknown) =>
        finish(() =>
          reject(
            error instanceof RunnerAcquisitionError
              ? error
              : new RunnerAcquisitionError(
                  'acquisition_response_invalid',
                  'The trusted release request failed.',
                ),
          ),
        );
      const requestOptions: RequestOptions = {
        method: 'GET',
        headers: input.headers,
      };
      const request = this.requestImplementation(
        new URL(input.url),
        requestOptions,
        (response) => {
          if (connectTimer !== null) clearTimeout(connectTimer);
          const result: ReleaseHttpResponse = {
            statusCode: response.statusCode ?? 0,
            headers: normalizeHeaders(response.headers),
          };
          const resetReadTimer = () => {
            if (readTimer !== null) clearTimeout(readTimer);
            readTimer = setTimeout(() => {
              response.destroy(
                new RunnerAcquisitionError(
                  'acquisition_read_timeout',
                  'The trusted release response stopped making progress.',
                ),
              );
            }, input.timeouts.readMilliseconds);
          };
          void (async () => {
            try {
              await input.onResponse(result);
              resetReadTimer();
              for await (const rawChunk of response) {
                resetReadTimer();
                const chunk = Buffer.isBuffer(rawChunk)
                  ? rawChunk
                  : Buffer.from(rawChunk as Uint8Array);
                receivedBytes += chunk.byteLength;
                if (receivedBytes > input.maximumBytes) {
                  throw new RunnerAcquisitionError(
                    input.maximumExceededCode,
                    'The trusted release response exceeded its byte limit.',
                  );
                }
                await input.onChunk(chunk);
              }
              finish(() => resolve(result));
            } catch (error: unknown) {
              response.destroy();
              fail(error);
            }
          })();
        },
      );
      connectTimer = setTimeout(() => {
        request.destroy(
          new RunnerAcquisitionError(
            'acquisition_connect_timeout',
            'The trusted release source connection timed out.',
          ),
        );
      }, input.timeouts.connectMilliseconds);
      totalTimer = setTimeout(() => {
        request.destroy(
          new RunnerAcquisitionError(
            'acquisition_request_timeout',
            'The trusted release request exceeded its deadline.',
          ),
        );
      }, input.totalTimeoutMilliseconds);
      request.once('socket', (socket) => {
        if (!socket.connecting && connectTimer !== null) {
          clearTimeout(connectTimer);
        }
        socket.once('secureConnect', () => {
          if (connectTimer !== null) clearTimeout(connectTimer);
        });
      });
      request.once('error', fail);
      request.end();
    });
  }
}

function normalizeHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): Readonly<Record<string, string | undefined>> {
  const normalized: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    normalized[name.toLowerCase()] = Array.isArray(value)
      ? value.join(', ')
      : value;
  }
  return normalized;
}
