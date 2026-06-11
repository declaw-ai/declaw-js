import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http } from 'msw';
import { setupServer } from 'msw/node';

import { Commands } from '../../../../src/sandbox/commands/commands.js';
import { ApiClient } from '../../../../src/api/client.js';
import { ConnectionConfig } from '../../../../src/connectionConfig.js';

const BASE_URL = 'http://localhost:9999';
const SANDBOX_ID = 'sbx-stream-test';

function makeClient(): ApiClient {
  return new ApiClient(
    new ConnectionConfig({ apiKey: 'test-key', domain: 'localhost:9999' }),
    { maxRetries: 1, retryDelay: 0 },
  );
}

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Commands.runStream()', () => {
  it('sends correct request body (cmd, stream: true, user defaults)', async () => {
    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands/stream`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return sseResponse([
          'event: exit\ndata: {"exit_code":0}\n\n',
        ]);
      }),
    );

    const commands = new Commands(SANDBOX_ID, makeClient());
    await commands.runStream('echo hello');

    expect(capturedBody.cmd).toBe('echo hello');
    expect(capturedBody.stream).toBe(true);
    expect(capturedBody.user).toBe('user');
    expect(capturedBody.timeout).toBe(60);
  });

  it('uses Bearer auth header (not X-API-Key)', async () => {
    let capturedHeaders: Record<string, string> = {};
    server.use(
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands/stream`, async ({ request }) => {
        capturedHeaders = Object.fromEntries(request.headers.entries());
        return sseResponse([
          'event: exit\ndata: {"exit_code":0}\n\n',
        ]);
      }),
    );

    const commands = new Commands(SANDBOX_ID, makeClient());
    await commands.runStream('ls');

    expect(capturedHeaders['authorization']).toBe('Bearer test-key');
    expect(capturedHeaders['x-api-key']).toBeUndefined();
  });

  it('parses stdout events and calls onStdout callback', async () => {
    server.use(
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands/stream`, () => {
        return sseResponse([
          'event: output\ndata: {"type":"stdout","data":"line1\\n"}\n\n',
          'event: output\ndata: {"type":"stdout","data":"line2\\n"}\n\n',
          'event: exit\ndata: {"exit_code":0}\n\n',
        ]);
      }),
    );

    const stdoutLines: string[] = [];
    const commands = new Commands(SANDBOX_ID, makeClient());
    await commands.runStream('echo lines', {
      onStdout: (line) => stdoutLines.push(line),
    });

    expect(stdoutLines).toEqual(['line1\n', 'line2\n']);
  });

  it('parses stderr events and calls onStderr callback', async () => {
    server.use(
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands/stream`, () => {
        return sseResponse([
          'event: output\ndata: {"type":"stderr","data":"warn1\\n"}\n\n',
          'event: output\ndata: {"type":"stderr","data":"warn2\\n"}\n\n',
          'event: exit\ndata: {"exit_code":0}\n\n',
        ]);
      }),
    );

    const stderrLines: string[] = [];
    const commands = new Commands(SANDBOX_ID, makeClient());
    await commands.runStream('warn-cmd', {
      onStderr: (line) => stderrLines.push(line),
    });

    expect(stderrLines).toEqual(['warn1\n', 'warn2\n']);
  });

  it('returns accumulated CommandResult with stdout, stderr, and exitCode', async () => {
    server.use(
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands/stream`, () => {
        return sseResponse([
          'event: output\ndata: {"type":"stdout","data":"hello\\n"}\n\n',
          'event: output\ndata: {"type":"stderr","data":"warn\\n"}\n\n',
          'event: output\ndata: {"type":"stdout","data":"world\\n"}\n\n',
          'event: exit\ndata: {"exit_code":0}\n\n',
        ]);
      }),
    );

    const commands = new Commands(SANDBOX_ID, makeClient());
    const result = await commands.runStream('mixed-cmd');

    expect(result.stdout).toBe('hello\nworld\n');
    expect(result.stderr).toBe('warn\n');
    expect(result.exitCode).toBe(0);
  });

  it('handles non-zero exit_code correctly', async () => {
    server.use(
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands/stream`, () => {
        return sseResponse([
          'event: output\ndata: {"type":"stderr","data":"error: not found\\n"}\n\n',
          'event: exit\ndata: {"exit_code":127}\n\n',
        ]);
      }),
    );

    const commands = new Commands(SANDBOX_ID, makeClient());
    const result = await commands.runStream('bad-cmd');

    expect(result.exitCode).toBe(127);
    expect(result.stderr).toBe('error: not found\n');
  });

  it('sends custom options (envs, cwd, user, timeout)', async () => {
    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands/stream`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return sseResponse([
          'event: exit\ndata: {"exit_code":0}\n\n',
        ]);
      }),
    );

    const commands = new Commands(SANDBOX_ID, makeClient());
    await commands.runStream('ls -la', {
      envs: { FOO: 'bar' },
      cwd: '/tmp',
      user: 'root',
      timeout: 120,
    });

    expect(capturedBody.envs).toEqual({ FOO: 'bar' });
    expect(capturedBody.cwd).toBe('/tmp');
    expect(capturedBody.user).toBe('root');
    expect(capturedBody.timeout).toBe(120);
    expect(capturedBody.stream).toBe(true);
  });

  it('handles error events by throwing SandboxError', async () => {
    server.use(
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands/stream`, () => {
        return sseResponse([
          'event: error\ndata: {"error":"command timed out"}\n\n',
        ]);
      }),
    );

    const commands = new Commands(SANDBOX_ID, makeClient());
    await expect(commands.runStream('slow-cmd')).rejects.toThrow('command timed out');
  });

  it('works without callbacks and just returns result', async () => {
    server.use(
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/commands/stream`, () => {
        return sseResponse([
          'event: output\ndata: {"type":"stdout","data":"hello\\n"}\n\n',
          'event: output\ndata: {"type":"stderr","data":"warn\\n"}\n\n',
          'event: exit\ndata: {"exit_code":0}\n\n',
        ]);
      }),
    );

    const commands = new Commands(SANDBOX_ID, makeClient());
    const result = await commands.runStream('echo hello');

    expect(result.stdout).toBe('hello\n');
    expect(result.stderr).toBe('warn\n');
    expect(result.exitCode).toBe(0);
  });
});
