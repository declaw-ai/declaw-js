import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { Commands } from '../../../../src/sandbox/commands/commands.js';
import { CommandHandle } from '../../../../src/sandbox/commands/commandHandle.js';
import { ApiClient } from '../../../../src/api/client.js';
import { ConnectionConfig } from '../../../../src/connectionConfig.js';

const BASE_URL = 'http://localhost:9999';
const SANDBOX_ID = 'sbx-cmd-test';

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

describe('Commands', () => {
  // ---- run() foreground ----

  describe('run() foreground', () => {
    it('sends POST /sandboxes/:id/commands with correct body and returns CommandResult', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            stdout: 'hello\n',
            stderr: '',
            exit_code: 0,
          });
        }),
      );

      const commands = new Commands(SANDBOX_ID, makeClient());
      const result = await commands.run('echo hello');

      expect(capturedBody.cmd).toBe('echo hello');
      expect(capturedBody.background).toBe(false);
      expect(capturedBody.user).toBe('user');
      expect(capturedBody.timeout).toBe(60);
      expect(result.stdout).toBe('hello\n');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    });

    it('sends all options in request body', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            stdout: '',
            stderr: '',
            exit_code: 0,
          });
        }),
      );

      const commands = new Commands(SANDBOX_ID, makeClient());
      await commands.run('ls -la', {
        envs: { FOO: 'bar' },
        cwd: '/tmp',
        user: 'root',
        timeout: 120,
      });

      expect(capturedBody.cmd).toBe('ls -la');
      expect(capturedBody.envs).toEqual({ FOO: 'bar' });
      expect(capturedBody.cwd).toBe('/tmp');
      expect(capturedBody.user).toBe('root');
      expect(capturedBody.timeout).toBe(120);
      expect(capturedBody.background).toBe(false);
    });

    it('invokes onStdout and onStderr callbacks line-by-line', async () => {
      server.use(
        http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands`, () =>
          HttpResponse.json({
            stdout: 'line1\nline2\nline3\n',
            stderr: 'warn1\nwarn2\n',
            exit_code: 0,
          }),
        ),
      );

      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];

      const commands = new Commands(SANDBOX_ID, makeClient());
      const result = await commands.run('some-cmd', {
        onStdout: (line) => stdoutLines.push(line),
        onStderr: (line) => stderrLines.push(line),
      });

      expect(stdoutLines).toEqual(['line1\n', 'line2\n', 'line3\n']);
      expect(stderrLines).toEqual(['warn1\n', 'warn2\n']);
      expect(result.exitCode).toBe(0);
    });
  });

  // ---- run() background ----

  describe('run() background', () => {
    it('sends POST with background: true and returns CommandHandle with pid', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ pid: 1234 });
        }),
      );

      const commands = new Commands(SANDBOX_ID, makeClient());
      const handle = await commands.run('sleep 100', { background: true });

      expect(capturedBody.background).toBe(true);
      expect(handle).toBeInstanceOf(CommandHandle);
      expect(handle.pid).toBe(1234);
    });

    it('passes other options alongside background', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ pid: 5678 });
        }),
      );

      const commands = new Commands(SANDBOX_ID, makeClient());
      const handle = await commands.run('python script.py', {
        background: true,
        envs: { PYTHONPATH: '/app' },
        cwd: '/app',
        user: 'root',
        timeout: 300,
      });

      expect(capturedBody.background).toBe(true);
      expect(capturedBody.envs).toEqual({ PYTHONPATH: '/app' });
      expect(capturedBody.cwd).toBe('/app');
      expect(capturedBody.user).toBe('root');
      expect(capturedBody.timeout).toBe(300);
      expect(handle.pid).toBe(5678);
    });
  });

  // ---- list() ----

  describe('list()', () => {
    it('sends GET /sandboxes/:id/commands and returns parsed ProcessInfo array', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json([
            { pid: 1, cmd: 'bash', is_pty: false, envs: {} },
            { pid: 2, cmd: 'python', is_pty: true, envs: { TERM: 'xterm' } },
          ]);
        }),
      );

      const commands = new Commands(SANDBOX_ID, makeClient());
      const processes = await commands.list();

      expect(capturedUrl).toContain(`/sandboxes/${SANDBOX_ID}/commands`);
      expect(processes).toHaveLength(2);
      expect(processes[0].pid).toBe(1);
      expect(processes[0].cmd).toBe('bash');
      expect(processes[0].isPty).toBe(false);
      expect(processes[1].pid).toBe(2);
      expect(processes[1].cmd).toBe('python');
      expect(processes[1].isPty).toBe(true);
      expect(processes[1].envs).toEqual({ TERM: 'xterm' });
    });

    it('returns empty array when no processes are running', async () => {
      server.use(
        http.get(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands`, () =>
          HttpResponse.json([]),
        ),
      );

      const commands = new Commands(SANDBOX_ID, makeClient());
      const processes = await commands.list();
      expect(processes).toHaveLength(0);
    });
  });

  // ---- kill() ----

  describe('kill()', () => {
    it('sends DELETE /sandboxes/:id/commands/:pid and returns boolean', async () => {
      let capturedUrl = '';
      server.use(
        http.delete(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands/42`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ killed: true });
        }),
      );

      const commands = new Commands(SANDBOX_ID, makeClient());
      const killed = await commands.kill(42);

      expect(capturedUrl).toContain(`/sandboxes/${SANDBOX_ID}/commands/42`);
      expect(killed).toBe(true);
    });

    it('returns false when process was not found or already killed', async () => {
      server.use(
        http.delete(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands/99`, () =>
          HttpResponse.json({ killed: false }),
        ),
      );

      const commands = new Commands(SANDBOX_ID, makeClient());
      const killed = await commands.kill(99);
      expect(killed).toBe(false);
    });
  });

  // ---- sendStdin() ----

  describe('sendStdin()', () => {
    it('sends POST /sandboxes/:id/commands/:pid/stdin with correct body', async () => {
      let capturedBody: Record<string, unknown> = {};
      let capturedUrl = '';
      server.use(
        http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands/42/stdin`, async ({ request }) => {
          capturedUrl = request.url;
          capturedBody = (await request.json()) as Record<string, unknown>;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const commands = new Commands(SANDBOX_ID, makeClient());
      await commands.sendStdin(42, 'hello\n');

      expect(capturedUrl).toContain(`/sandboxes/${SANDBOX_ID}/commands/42/stdin`);
      expect(capturedBody.data).toBe('hello\n');
    });
  });

  // ---- connect() ----

  describe('connect()', () => {
    it('returns CommandHandle without making an API call', () => {
      // Set up a handler that should NOT be called
      let apiCalled = false;
      server.use(
        http.get(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands/42`, () => {
          apiCalled = true;
          return HttpResponse.json({});
        }),
      );

      const commands = new Commands(SANDBOX_ID, makeClient());
      const handle = commands.connect(42);

      expect(handle).toBeInstanceOf(CommandHandle);
      expect(handle.pid).toBe(42);
      expect(apiCalled).toBe(false);
    });
  });
});
