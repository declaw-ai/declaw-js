import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, resetState } from '../mock-backend/server.js';
import type { MockServer } from '../mock-backend/server.js';
import { ConnectionConfig } from '../../src/connectionConfig.js';
import { ApiClient } from '../../src/api/client.js';
import { Filesystem } from '../../src/sandbox/filesystem/filesystem.js';
import { FileType } from '../../src/sandbox/filesystem/models.js';

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

/** Create a sandbox and return a Filesystem instance with cleanup. */
async function createSandboxFs(): Promise<{
  sandboxId: string;
  files: Filesystem;
  client: ApiClient;
}> {
  const client = new ApiClient(config, { maxRetries: 1, retryDelay: 0 });
  const data = (await client.post('/sandboxes', {
    json: { template: 'base', timeout: 300 },
  })) as Record<string, unknown>;
  const sandboxId = data.sandbox_id as string;
  const files = new Filesystem(sandboxId, client);
  return { sandboxId, files, client };
}

describe('Filesystem integration tests', () => {
  it('should write a file and read it back', async () => {
    const { files, client } = await createSandboxFs();
    try {
      const content = 'Hello, Declaw!';
      const writeInfo = await files.write('/test.txt', content);
      expect(writeInfo.path).toBe('/test.txt');
      expect(writeInfo.size).toBe(content.length);

      const readBack = await files.read('/test.txt');
      expect(readBack).toBe(content);
    } finally {
      client.close();
    }
  });

  it('should write multiple files (batch)', async () => {
    const { files, client } = await createSandboxFs();
    try {
      const entries = [
        { path: '/batch/a.txt', data: 'content-a' },
        { path: '/batch/b.txt', data: 'content-b' },
        { path: '/batch/c.txt', data: 'content-c' },
      ];
      const results = await files.writeFiles(entries);
      expect(results).toHaveLength(3);
      expect(results[0].path).toBe('/batch/a.txt');
      expect(results[1].path).toBe('/batch/b.txt');
      expect(results[2].path).toBe('/batch/c.txt');

      // Verify content
      const a = await files.read('/batch/a.txt');
      expect(a).toBe('content-a');
      const c = await files.read('/batch/c.txt');
      expect(c).toBe('content-c');
    } finally {
      client.close();
    }
  });

  it('should list directory', async () => {
    const { files, client } = await createSandboxFs();
    try {
      await files.write('/listdir/file1.txt', 'f1');
      await files.write('/listdir/file2.txt', 'f2');
      await files.makeDir('/listdir/subdir');

      const entries = await files.list('/listdir');
      expect(entries.length).toBeGreaterThanOrEqual(3);
      const names = entries.map((e) => e.name);
      expect(names).toContain('file1.txt');
      expect(names).toContain('file2.txt');
      expect(names).toContain('subdir');

      const subdir = entries.find((e) => e.name === 'subdir');
      expect(subdir!.type).toBe(FileType.Dir);

      const file1 = entries.find((e) => e.name === 'file1.txt');
      expect(file1!.type).toBe(FileType.File);
    } finally {
      client.close();
    }
  });

  it('should check file exists (true and false)', async () => {
    const { files, client } = await createSandboxFs();
    try {
      await files.write('/exists-test.txt', 'data');

      const existsTrue = await files.exists('/exists-test.txt');
      expect(existsTrue).toBe(true);

      const existsFalse = await files.exists('/no-such-file.txt');
      expect(existsFalse).toBe(false);
    } finally {
      client.close();
    }
  });

  it('should get file info', async () => {
    const { files, client } = await createSandboxFs();
    try {
      const content = 'info test content';
      await files.write('/info-test.txt', content);

      const info = await files.getInfo('/info-test.txt');
      expect(info.name).toBe('info-test.txt');
      expect(info.path).toBe('/info-test.txt');
      expect(info.type).toBe(FileType.File);
      expect(info.size).toBe(content.length);
    } finally {
      client.close();
    }
  });

  it('should rename a file', async () => {
    const { files, client } = await createSandboxFs();
    try {
      await files.write('/rename-src.txt', 'rename me');

      const result = await files.rename('/rename-src.txt', '/rename-dst.txt');
      expect(result.name).toBe('rename-dst.txt');
      expect(result.path).toBe('/rename-dst.txt');
      expect(result.type).toBe(FileType.File);

      // Old file should not exist
      const oldExists = await files.exists('/rename-src.txt');
      expect(oldExists).toBe(false);

      // New file should have the same content
      const content = await files.read('/rename-dst.txt');
      expect(content).toBe('rename me');
    } finally {
      client.close();
    }
  });

  it('should remove a file', async () => {
    const { files, client } = await createSandboxFs();
    try {
      await files.write('/remove-me.txt', 'bye');
      const existsBefore = await files.exists('/remove-me.txt');
      expect(existsBefore).toBe(true);

      await files.remove('/remove-me.txt');
      const existsAfter = await files.exists('/remove-me.txt');
      expect(existsAfter).toBe(false);
    } finally {
      client.close();
    }
  });

  it('should make a directory', async () => {
    const { files, client } = await createSandboxFs();
    try {
      const created = await files.makeDir('/new-dir/nested');
      expect(created).toBe(true);

      const exists = await files.exists('/new-dir/nested');
      expect(exists).toBe(true);

      const info = await files.getInfo('/new-dir/nested');
      expect(info.type).toBe(FileType.Dir);
    } finally {
      client.close();
    }
  });

  it('should write and read with special characters', async () => {
    const { files, client } = await createSandboxFs();
    try {
      const specialContent = 'Line 1\nLine 2\tTabbed\n日本語テスト\n"quotes" & <brackets>';
      await files.write('/special.txt', specialContent);

      const readBack = await files.read('/special.txt');
      expect(readBack).toBe(specialContent);
    } finally {
      client.close();
    }
  });

  it('should handle full lifecycle: mkdir -> write -> list -> read -> rename -> remove', async () => {
    const { files, client } = await createSandboxFs();
    try {
      // mkdir
      await files.makeDir('/lifecycle-dir');

      // write
      await files.write('/lifecycle-dir/test.txt', 'lifecycle data');

      // list
      const entries = await files.list('/lifecycle-dir');
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('test.txt');

      // read
      const content = await files.read('/lifecycle-dir/test.txt');
      expect(content).toBe('lifecycle data');

      // rename
      const renamed = await files.rename(
        '/lifecycle-dir/test.txt',
        '/lifecycle-dir/renamed.txt',
      );
      expect(renamed.name).toBe('renamed.txt');

      // remove
      await files.remove('/lifecycle-dir/renamed.txt');
      const exists = await files.exists('/lifecycle-dir/renamed.txt');
      expect(exists).toBe(false);
    } finally {
      client.close();
    }
  });
});
