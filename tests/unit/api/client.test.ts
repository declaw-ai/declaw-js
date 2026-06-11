import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { ApiClient } from '../../../src/api/client.js';
import { ConnectionConfig } from '../../../src/connectionConfig.js';
import {
  AuthenticationError,
  NotFoundError,
  TimeoutError,
  InvalidArgumentError,
  NotEnoughSpaceError,
  SandboxError,
} from '../../../src/errors.js';

const BASE_URL = 'http://localhost:9999';

function makeConfig(overrides?: { apiKey?: string; requestTimeout?: number }): ConnectionConfig {
  return new ConnectionConfig({
    apiKey: overrides?.apiKey ?? 'test-api-key',
    apiUrl: BASE_URL,
    requestTimeout: overrides?.requestTimeout,
  });
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('ApiClient', () => {
  // ---- HTTP methods ----

  describe('HTTP methods', () => {
    it('GET sends correct method, URL, and auth header', async () => {
      let capturedMethod = '';
      let capturedAuth = '';
      server.use(
        http.get(`${BASE_URL}/test-path`, ({ request }) => {
          capturedMethod = request.method;
          capturedAuth = request.headers.get('authorization') ?? '';
          return HttpResponse.json({ ok: true });
        }),
      );

      const client = new ApiClient(makeConfig());
      const result = await client.get('/test-path');
      expect(capturedMethod).toBe('GET');
      expect(capturedAuth).toBe('Bearer test-api-key');
      expect(result).toEqual({ ok: true });
      client.close();
    });

    it('POST sends correct method with JSON body', async () => {
      let capturedBody: unknown = null;
      let capturedContentType = '';
      server.use(
        http.post(`${BASE_URL}/items`, async ({ request }) => {
          capturedContentType = request.headers.get('content-type') ?? '';
          capturedBody = await request.json();
          return HttpResponse.json({ id: 1 });
        }),
      );

      const client = new ApiClient(makeConfig());
      const result = await client.post('/items', { json: { name: 'thing' } });
      expect(capturedContentType).toContain('application/json');
      expect(capturedBody).toEqual({ name: 'thing' });
      expect(result).toEqual({ id: 1 });
      client.close();
    });

    it('PATCH sends correct method', async () => {
      server.use(
        http.patch(`${BASE_URL}/items/1`, () => HttpResponse.json({ updated: true })),
      );

      const client = new ApiClient(makeConfig());
      const result = await client.patch('/items/1', { json: { name: 'updated' } });
      expect(result).toEqual({ updated: true });
      client.close();
    });

    it('DELETE sends correct method', async () => {
      server.use(
        http.delete(`${BASE_URL}/items/1`, () => HttpResponse.json({ deleted: true })),
      );

      const client = new ApiClient(makeConfig());
      const result = await client.delete('/items/1');
      expect(result).toEqual({ deleted: true });
      client.close();
    });

    it('PUT sends correct method with JSON body', async () => {
      let capturedBody: unknown = null;
      server.use(
        http.put(`${BASE_URL}/items/1`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ replaced: true });
        }),
      );

      const client = new ApiClient(makeConfig());
      const result = await client.put('/items/1', { json: { name: 'replaced' } });
      expect(capturedBody).toEqual({ name: 'replaced' });
      expect(result).toEqual({ replaced: true });
      client.close();
    });
  });

  // ---- Auth header ----

  describe('Auth header', () => {
    it('always uses Authorization: Bearer, never X-API-Key', async () => {
      let capturedHeaders: Record<string, string> = {};
      server.use(
        http.get(`${BASE_URL}/auth-check`, ({ request }) => {
          capturedHeaders = {
            authorization: request.headers.get('authorization') ?? '',
            'x-api-key': request.headers.get('x-api-key') ?? '',
          };
          return HttpResponse.json({});
        }),
      );

      const client = new ApiClient(makeConfig({ apiKey: 'my-secret-key' }));
      await client.get('/auth-check');
      expect(capturedHeaders['authorization']).toBe('Bearer my-secret-key');
      expect(capturedHeaders['x-api-key']).toBe('');
      client.close();
    });
  });

  // ---- Query params ----

  describe('Query params', () => {
    it('appends query params to URL', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${BASE_URL}/search`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ results: [] });
        }),
      );

      const client = new ApiClient(makeConfig());
      await client.get('/search', { params: { q: 'hello', page: '1' } });
      const url = new URL(capturedUrl);
      expect(url.searchParams.get('q')).toBe('hello');
      expect(url.searchParams.get('page')).toBe('1');
      client.close();
    });
  });

  // ---- JSON body serialization ----

  describe('JSON body serialization', () => {
    it('serializes complex JSON body', async () => {
      let capturedBody: unknown = null;
      server.use(
        http.post(`${BASE_URL}/complex`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ ok: true });
        }),
      );

      const body = { nested: { array: [1, 2, 3], obj: { key: 'value' } } };
      const client = new ApiClient(makeConfig());
      await client.post('/complex', { json: body });
      expect(capturedBody).toEqual(body);
      client.close();
    });
  });

  // ---- Raw body ----

  describe('Raw body', () => {
    it('sends raw string body when body option is provided', async () => {
      let capturedBody = '';
      server.use(
        http.post(`${BASE_URL}/raw`, async ({ request }) => {
          capturedBody = await request.text();
          return HttpResponse.json({ ok: true });
        }),
      );

      const client = new ApiClient(makeConfig());
      await client.post('/raw', { body: 'raw-content' });
      expect(capturedBody).toBe('raw-content');
      client.close();
    });
  });

  // ---- Custom headers ----

  describe('Custom headers', () => {
    it('merges custom headers with default headers', async () => {
      let capturedCustom = '';
      server.use(
        http.get(`${BASE_URL}/custom-headers`, ({ request }) => {
          capturedCustom = request.headers.get('x-custom') ?? '';
          return HttpResponse.json({});
        }),
      );

      const client = new ApiClient(makeConfig());
      await client.get('/custom-headers', { headers: { 'X-Custom': 'val' } });
      expect(capturedCustom).toBe('val');
      client.close();
    });
  });

  // ---- Error mapping ----

  describe('Error mapping', () => {
    const errorCases = [
      { status: 401, ErrorClass: AuthenticationError, name: 'AuthenticationError' },
      { status: 403, ErrorClass: AuthenticationError, name: 'AuthenticationError' },
      { status: 404, ErrorClass: NotFoundError, name: 'NotFoundError' },
      { status: 408, ErrorClass: TimeoutError, name: 'TimeoutError' },
      { status: 422, ErrorClass: InvalidArgumentError, name: 'InvalidArgumentError' },
      { status: 507, ErrorClass: NotEnoughSpaceError, name: 'NotEnoughSpaceError' },
    ] as const;

    for (const { status, ErrorClass, name } of errorCases) {
      it(`${status} maps to ${name}`, async () => {
        server.use(
          http.get(`${BASE_URL}/err`, () =>
            HttpResponse.json({ message: `error ${status}` }, { status }),
          ),
        );

        const client = new ApiClient(makeConfig());
        await expect(client.get('/err')).rejects.toThrow(ErrorClass);
        client.close();
      });
    }

    it('5xx maps to SandboxError after retries exhausted', async () => {
      server.use(
        http.get(`${BASE_URL}/server-err`, () =>
          HttpResponse.json({ message: 'internal' }, { status: 500 }),
        ),
      );

      const client = new ApiClient(makeConfig(), { maxRetries: 1, retryDelay: 0 });
      await expect(client.get('/server-err')).rejects.toThrow(SandboxError);
      client.close();
    });

    it('error message includes HTTP status and body message', async () => {
      server.use(
        http.get(`${BASE_URL}/err-msg`, () =>
          HttpResponse.json({ message: 'sandbox not found' }, { status: 404 }),
        ),
      );

      const client = new ApiClient(makeConfig());
      try {
        await client.get('/err-msg');
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundError);
        expect((e as NotFoundError).message).toContain('404');
        expect((e as NotFoundError).message).toContain('sandbox not found');
      }
      client.close();
    });
  });

  // ---- Retry behavior ----

  describe('Retry behavior', () => {
    it('retries on 5xx and eventually succeeds', async () => {
      let requestCount = 0;
      server.use(
        http.get(`${BASE_URL}/flaky`, () => {
          requestCount++;
          if (requestCount < 3) {
            return HttpResponse.json({ error: 'fail' }, { status: 500 });
          }
          return HttpResponse.json({ ok: true });
        }),
      );

      const client = new ApiClient(makeConfig(), { maxRetries: 3, retryDelay: 0 });
      const result = await client.get('/flaky');
      expect(result).toEqual({ ok: true });
      expect(requestCount).toBe(3);
      client.close();
    });

    it('does NOT retry on 4xx errors', async () => {
      let requestCount = 0;
      server.use(
        http.get(`${BASE_URL}/no-retry`, () => {
          requestCount++;
          return HttpResponse.json({ message: 'bad request' }, { status: 422 });
        }),
      );

      const client = new ApiClient(makeConfig(), { maxRetries: 3, retryDelay: 0 });
      await expect(client.get('/no-retry')).rejects.toThrow(InvalidArgumentError);
      expect(requestCount).toBe(1);
      client.close();
    });

    it('retries on network errors (fetch failures)', async () => {
      let requestCount = 0;
      server.use(
        http.get(`${BASE_URL}/net-fail`, () => {
          requestCount++;
          if (requestCount < 2) {
            return HttpResponse.error();
          }
          return HttpResponse.json({ ok: true });
        }),
      );

      const client = new ApiClient(makeConfig(), { maxRetries: 3, retryDelay: 0 });
      const result = await client.get('/net-fail');
      expect(result).toEqual({ ok: true });
      expect(requestCount).toBe(2);
      client.close();
    });

    it('throws SandboxError after all retries exhausted on network error', async () => {
      server.use(
        http.get(`${BASE_URL}/always-fail`, () => HttpResponse.error()),
      );

      const client = new ApiClient(makeConfig(), { maxRetries: 2, retryDelay: 0 });
      await expect(client.get('/always-fail')).rejects.toThrow(SandboxError);
      client.close();
    });
  });

  // ---- stream() ----

  describe('stream()', () => {
    it('returns raw Response without parsing body', async () => {
      server.use(
        http.post(`${BASE_URL}/stream`, () => {
          return new HttpResponse('data: hello\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          });
        }),
      );

      const client = new ApiClient(makeConfig());
      const response = await client.stream('/stream');
      // stream returns the raw Response object
      expect(response).toBeInstanceOf(Response);
      expect(response.body).toBeDefined();
      // Verify we can read the raw text
      const text = await response.text();
      expect(text).toBe('data: hello\n\n');
      client.close();
    });

    it('stream() uses Bearer auth header', async () => {
      let capturedAuth = '';
      server.use(
        http.post(`${BASE_URL}/stream-auth`, ({ request }) => {
          capturedAuth = request.headers.get('authorization') ?? '';
          return new HttpResponse('data: ok\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          });
        }),
      );

      const client = new ApiClient(makeConfig({ apiKey: 'stream-key' }));
      await client.stream('/stream-auth');
      expect(capturedAuth).toBe('Bearer stream-key');
      client.close();
    });
  });

  // ---- close() / resource safety ----

  describe('close()', () => {
    it('aborts pending requests', async () => {
      server.use(
        http.get(`${BASE_URL}/slow`, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return HttpResponse.json({ ok: true });
        }),
      );

      const client = new ApiClient(makeConfig());
      const promise = client.get('/slow');
      // Give the request a moment to start
      await new Promise((resolve) => setTimeout(resolve, 50));
      client.close();
      await expect(promise).rejects.toThrow();
    });
  });

  // ---- Default config from environment ----

  describe('Default config from environment', () => {
    it('creates client with default ConnectionConfig when none provided', () => {
      const client = new ApiClient();
      // Should not throw — creates a default ConnectionConfig
      expect(client).toBeInstanceOf(ApiClient);
      client.close();
    });
  });

  // ---- Empty response handling ----

  describe('Empty response handling', () => {
    it('handles 204 No Content responses', async () => {
      server.use(
        http.delete(`${BASE_URL}/items/1`, () =>
          new HttpResponse(null, { status: 204 }),
        ),
      );

      const client = new ApiClient(makeConfig());
      const result = await client.delete('/items/1');
      expect(result).toBeNull();
      client.close();
    });
  });
});
