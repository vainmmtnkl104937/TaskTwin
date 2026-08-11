import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { request as httpsRequest } from 'node:https';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { NodeHttpsReleaseClient } from './https-release-client.js';

type HttpsRequest = typeof httpsRequest;

function requestFixture(
  respond: (response: PassThrough) => void,
): HttpsRequest {
  return ((
    _url: URL,
    _options: unknown,
    callback: (response: IncomingMessage) => void,
  ) => {
    const events = new EventEmitter();
    const request = Object.assign(events, {
      end: () => {
        queueMicrotask(() => {
          const response = Object.assign(new PassThrough(), {
            statusCode: 200,
            headers: {},
          });
          callback(response as unknown as IncomingMessage);
          respond(response);
        });
      },
      destroy: (error?: Error) => {
        if (error !== undefined)
          queueMicrotask(() => events.emit('error', error));
        return request;
      },
    });
    return request as unknown as ClientRequest;
  }) as unknown as HttpsRequest;
}

const timeouts = {
  connectMilliseconds: 1_000,
  readMilliseconds: 1_000,
  metadataRequestMilliseconds: 1_000,
  artifactRequestMilliseconds: 10_000,
};

describe('Node HTTPS release client bounds', () => {
  it('rejects streamed response bytes beyond the configured maximum', async () => {
    const client = new NodeHttpsReleaseClient(
      requestFixture((response) => response.end(Buffer.from('too-large'))),
    );

    await expect(
      client.request({
        url: 'https://releases.tasktwin.test/runner/releases/v1/1.5.0/file',
        maximumBytes: 4,
        maximumExceededCode: 'acquisition_metadata_too_large',
        totalTimeoutMilliseconds: 1_000,
        timeouts,
        onResponse: () => undefined,
        onChunk: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'acquisition_metadata_too_large' });
  });

  it('enforces the bounded read-progress timeout', async () => {
    const client = new NodeHttpsReleaseClient(
      requestFixture(() => {
        // Deliberately leave the response open without making progress.
      }),
    );

    await expect(
      client.request({
        url: 'https://releases.tasktwin.test/runner/releases/v1/1.5.0/file',
        maximumBytes: 4,
        maximumExceededCode: 'acquisition_metadata_too_large',
        totalTimeoutMilliseconds: 2_000,
        timeouts: { ...timeouts, readMilliseconds: 20 },
        onResponse: () => undefined,
        onChunk: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'acquisition_read_timeout' });
  });
});
