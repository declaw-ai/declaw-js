import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { CommandHandle } from '../../../../src/sandbox/commands/commandHandle.js';
import { ApiClient } from '../../../../src/api/client.js';
import { ConnectionConfig } from '../../../../src/connectionConfig.js';
import { CommandExitError } from '../../../../src/errors.js';

const BASE_URL = 'http://localhost:9999';

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

describe('CommandHandle', () => {
  describe('pid', () => {
    it('returns the pid passed to the constructor', () => {
      const handle = new CommandHandle(42, 'sbx-123', makeClient());
      expect(handle.pid).toBe(42);
    });
  });

  describe('wait()', () => {
    it('sends GET /sandboxes/:id/commands/:pid/wait and returns CommandResult', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${BASE_URL}/sandboxes/sbx-123/commands/42/wait`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({
            stdout: 'hello world\n',
            stderr: '',
            exit_code: 0,
          });
        }),
      );

      const handle = new CommandHandle(42, 'sbx-123', makeClient());
      const result = await handle.wait();

      expect(capturedUrl).toContain('/sandboxes/sbx-123/commands/42/wait');
      expect(result.stdout).toBe('hello world\n');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    });

    it('invokes onStdout and onStderr callbacks line-by-line', async () => {
      server.use(
        http.get(`${BASE_URL}/sandboxes/sbx-123/commands/42/wait`, () =>
          HttpResponse.json({
            stdout: 'line1\nline2\n',
            stderr: 'err1\nerr2\n',
            exit_code: 0,
          }),
        ),
      );

      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];

      const handle = new CommandHandle(42, 'sbx-123', makeClient());
      await handle.wait({
        onStdout: (line) => stdoutLines.push(line),
        onStderr: (line) => stderrLines.push(line),
      });

      expect(stdoutLines).toEqual(['line1\n', 'line2\n']);
      expect(stderrLines).toEqual(['err1\n', 'err2\n']);
    });

    it('throws CommandExitError on non-zero exit code', async () => {
      server.use(
        http.get(`${BASE_URL}/sandboxes/sbx-123/commands/42/wait`, () =>
          HttpResponse.json({
            stdout: 'partial output',
            stderr: 'something failed',
            exit_code: 1,
          }),
        ),
      );

      const handle = new CommandHandle(42, 'sbx-123', makeClient());
      try {
        await handle.wait();
        expect.fail('Expected CommandExitError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CommandExitError);
        const exitError = err as CommandExitError;
        expect(exitError.exitCode).toBe(1);
        expect(exitError.stdout).toBe('partial output');
        expect(exitError.stderr).toBe('something failed');
      }
    });

    it('calls callbacks before throwing CommandExitError', async () => {
      server.use(
        http.get(`${BASE_URL}/sandboxes/sbx-123/commands/42/wait`, () =>
          HttpResponse.json({
            stdout: 'out1\nout2\n',
            stderr: 'err1\n',
            exit_code: 2,
          }),
        ),
      );

      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];

      const handle = new CommandHandle(42, 'sbx-123', makeClient());
      try {
        await handle.wait({
          onStdout: (line) => stdoutLines.push(line),
          onStderr: (line) => stderrLines.push(line),
        });
        expect.fail('Expected CommandExitError to be thrown');
      } catch (err) {
        // Callbacks should have been invoked before the throw
        expect(stdoutLines).toEqual(['out1\n', 'out2\n']);
        expect(stderrLines).toEqual(['err1\n']);
        expect(err).toBeInstanceOf(CommandExitError);
      }
    });
  });

  describe('kill()', () => {
    it('sends DELETE /sandboxes/:id/commands/:pid and returns boolean', async () => {
      let capturedUrl = '';
      server.use(
        http.delete(`${BASE_URL}/sandboxes/sbx-123/commands/42`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ killed: true });
        }),
      );

      const handle = new CommandHandle(42, 'sbx-123', makeClient());
      const killed = await handle.kill();

      expect(capturedUrl).toContain('/sandboxes/sbx-123/commands/42');
      expect(killed).toBe(true);
    });
  });

  describe('disconnect()', () => {
    it('is a no-op and does not throw', () => {
      const handle = new CommandHandle(42, 'sbx-123', makeClient());
      expect(() => handle.disconnect()).not.toThrow();
    });
  });
});
