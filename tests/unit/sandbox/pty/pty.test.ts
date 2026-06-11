import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { Pty, PtyHandle } from '../../../../src/sandbox/pty/pty.js';
import { ApiClient } from '../../../../src/api/client.js';
import { ConnectionConfig } from '../../../../src/connectionConfig.js';

const BASE_URL = 'http://localhost:9999';
const SANDBOX_ID = 'sbx-pty-test';

function makeClient(): ApiClient {
  return new ApiClient(
    new ConnectionConfig({ apiKey: 'test-key', domain: 'localhost:9999' }),
    { maxRetries: 1, retryDelay: 0 },
  );
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Pty', () => {
  describe('create()', () => {
    it('sends POST /sandboxes/:id/pty with default body and returns CommandHandle', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/pty`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ pid: 100 });
        }),
      );

      const pty = new Pty(SANDBOX_ID, makeClient());
      const handle = await pty.create();

      expect(capturedBody.size).toEqual({ cols: 80, rows: 24 });
      expect(capturedBody.user).toBe('user');
      expect(handle).toBeInstanceOf(PtyHandle);
      expect(handle.pid).toBe(100);
    });

    it('sends all options in request body', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/pty`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ pid: 200 });
        }),
      );

      const pty = new Pty(SANDBOX_ID, makeClient());
      const handle = await pty.create({
        size: { cols: 120, rows: 40 },
        user: 'root',
        cwd: '/tmp',
        envs: { TERM: 'xterm-256color' },
        timeout: 600,
      });

      expect(capturedBody.size).toEqual({ cols: 120, rows: 40 });
      expect(capturedBody.user).toBe('root');
      expect(capturedBody.cwd).toBe('/tmp');
      expect(capturedBody.envs).toEqual({ TERM: 'xterm-256color' });
      expect(capturedBody.timeout).toBe(600);
      expect(handle.pid).toBe(200);
    });
  });

  describe('kill()', () => {
    it('sends DELETE /sandboxes/:id/pty/:pid and returns boolean', async () => {
      let capturedUrl = '';
      server.use(
        http.delete(`${BASE_URL}/sandboxes/${SANDBOX_ID}/pty/100`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ killed: true });
        }),
      );

      const pty = new Pty(SANDBOX_ID, makeClient());
      const killed = await pty.kill(100);

      expect(capturedUrl).toContain(`/sandboxes/${SANDBOX_ID}/pty/100`);
      expect(killed).toBe(true);
    });
  });

  describe('sendStdin()', () => {
    it('sends POST /sandboxes/:id/pty/:pid/stdin with string data', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/pty/100/stdin`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const pty = new Pty(SANDBOX_ID, makeClient());
      await pty.sendStdin(100, 'ls -la\n');

      expect(capturedBody.data).toBe('ls -la\n');
    });

    it('decodes Uint8Array to string before sending', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/pty/100/stdin`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const pty = new Pty(SANDBOX_ID, makeClient());
      const bytes = new TextEncoder().encode('hello');
      await pty.sendStdin(100, bytes);

      expect(capturedBody.data).toBe('hello');
    });
  });

  describe('resize()', () => {
    it('sends PATCH /sandboxes/:id/pty/:pid with size body', async () => {
      let capturedBody: Record<string, unknown> = {};
      let capturedUrl = '';
      server.use(
        http.patch(`${BASE_URL}/sandboxes/${SANDBOX_ID}/pty/100`, async ({ request }) => {
          capturedUrl = request.url;
          capturedBody = (await request.json()) as Record<string, unknown>;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const pty = new Pty(SANDBOX_ID, makeClient());
      await pty.resize(100, { cols: 200, rows: 50 });

      expect(capturedUrl).toContain(`/sandboxes/${SANDBOX_ID}/pty/100`);
      expect(capturedBody.size).toEqual({ cols: 200, rows: 50 });
    });
  });
});
