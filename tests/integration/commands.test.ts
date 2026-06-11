import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, resetState } from '../mock-backend/server.js';
import type { MockServer } from '../mock-backend/server.js';
import { ConnectionConfig } from '../../src/connectionConfig.js';
import { ApiClient } from '../../src/api/client.js';
import { Commands } from '../../src/sandbox/commands/commands.js';
import { CommandHandle } from '../../src/sandbox/commands/commandHandle.js';
import { CommandExitError } from '../../src/errors.js';

let mock: MockServer;
let config: ConnectionConfig;

beforeAll(async () => {
  mock = await startServer();
  config = new ConnectionConfig({
    apiKey: 'test-key',
    apiUrl: `http://127.0.0.1:${mock.port}`,
  });
});

afterAll(async () => {
  resetState();
  await mock.close();
});

/** Create a sandbox and return Commands instance with cleanup. */
async function createSandboxCommands(): Promise<{
  sandboxId: string;
  commands: Commands;
  client: ApiClient;
}> {
  const client = new ApiClient(config, { maxRetries: 1, retryDelay: 0 });
  const data = (await client.post('/sandboxes', {
    json: { template: 'base', timeout: 300 },
  })) as Record<string, unknown>;
  const sandboxId = data.sandbox_id as string;
  const commands = new Commands(sandboxId, client);
  return { sandboxId, commands, client };
}

describe('Commands integration tests', () => {
  it('should run a simple command (echo) and verify stdout', async () => {
    const { commands, client } = await createSandboxCommands();
    try {
      const result = await commands.run('echo hello world');
      expect(result.stdout).toContain('hello world');
      expect(result.exitCode).toBe(0);
    } finally {
      client.close();
    }
  });

  it('should run a command with envs', async () => {
    const { commands, client } = await createSandboxCommands();
    try {
      const result = await commands.run('echo $MY_VAR', {
        envs: { MY_VAR: 'test-value-123' },
      });
      expect(result.stdout).toContain('test-value-123');
      expect(result.exitCode).toBe(0);
    } finally {
      client.close();
    }
  });

  it('should run a command with custom cwd', async () => {
    const { commands, client } = await createSandboxCommands();
    try {
      const result = await commands.run('pwd', { cwd: '/tmp' });
      // On macOS /tmp -> /private/tmp, so check both
      expect(result.stdout.trim()).toMatch(/\/(private\/)?tmp/);
      expect(result.exitCode).toBe(0);
    } finally {
      client.close();
    }
  });

  it('should run a background command and wait for it', async () => {
    const { commands, client } = await createSandboxCommands();
    try {
      const handle = await commands.run('echo background-output', {
        background: true,
      });
      expect(handle).toBeInstanceOf(CommandHandle);
      expect(handle.pid).toBeGreaterThan(0);

      const result = await handle.wait();
      expect(result.stdout).toContain('background-output');
      expect(result.exitCode).toBe(0);
    } finally {
      client.close();
    }
  });

  it('should list commands', async () => {
    const { commands, client } = await createSandboxCommands();
    try {
      // Start a background command so there is something to list
      const handle = await commands.run('sleep 1', { background: true });

      const procs = await commands.list();
      expect(procs.length).toBeGreaterThanOrEqual(1);
      const found = procs.find((p) => p.pid === handle.pid);
      expect(found).toBeDefined();
      expect(found!.cmd).toBe('sleep 1');
    } finally {
      client.close();
    }
  });

  it('should kill a command', async () => {
    const { commands, client } = await createSandboxCommands();
    try {
      const handle = await commands.run('sleep 10', { background: true });
      const killed = await commands.kill(handle.pid);
      expect(killed).toBe(true);

      // Command should no longer be in list
      const procs = await commands.list();
      const found = procs.find((p) => p.pid === handle.pid);
      expect(found).toBeUndefined();
    } finally {
      client.close();
    }
  });

  it('should send stdin to a command', async () => {
    const { commands, client } = await createSandboxCommands();
    try {
      const handle = await commands.run('cat', { background: true });
      // sendStdin should not throw
      await commands.sendStdin(handle.pid, 'hello\n');
      // Clean up
      await commands.kill(handle.pid);
    } finally {
      client.close();
    }
  });

  it('should throw CommandExitError on non-zero exit when waiting', async () => {
    const { commands, client } = await createSandboxCommands();
    try {
      const handle = await commands.run('exit 42', { background: true });

      try {
        await handle.wait();
        expect.fail('Should have thrown CommandExitError');
      } catch (err) {
        expect(err).toBeInstanceOf(CommandExitError);
        const cmdErr = err as CommandExitError;
        expect(cmdErr.exitCode).toBe(42);
      }
    } finally {
      client.close();
    }
  });

  it('should run foreground command with non-zero exit and get result', async () => {
    const { commands, client } = await createSandboxCommands();
    try {
      const result = await commands.run('exit 1');
      expect(result.exitCode).toBe(1);
    } finally {
      client.close();
    }
  });

  it('should invoke onStdout callback for foreground commands', async () => {
    const { commands, client } = await createSandboxCommands();
    try {
      const lines: string[] = [];
      const result = await commands.run('echo "line1" && echo "line2"', {
        onStdout: (line) => lines.push(line),
      });
      expect(result.exitCode).toBe(0);
      expect(lines.length).toBeGreaterThanOrEqual(1);
    } finally {
      client.close();
    }
  });
});
