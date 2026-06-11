import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, resetState } from '../mock-backend/server.js';
import type { MockServer } from '../mock-backend/server.js';
import { ConnectionConfig } from '../../src/connectionConfig.js';
import { ApiClient } from '../../src/api/client.js';
import { parseSandboxInfo, parseSandboxMetrics, parseSnapshotInfo, SandboxState } from '../../src/sandbox/models.js';

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

/** Helper to create a sandbox via API and return its data + a client. */
async function createSandbox(
  template = 'base',
  opts: Record<string, unknown> = {},
): Promise<{ sandboxId: string; data: Record<string, unknown>; client: ApiClient }> {
  const client = new ApiClient(config, { maxRetries: 1, retryDelay: 0 });
  const data = (await client.post('/sandboxes', {
    json: { template, timeout: 300, ...opts },
  })) as Record<string, unknown>;
  return { sandboxId: data.sandbox_id as string, data, client };
}

describe('Sandbox integration tests', () => {
  it('should create a sandbox and verify properties', async () => {
    const { sandboxId, data, client } = await createSandbox('node', {
      timeout: 600,
      metadata: { env: 'test' },
    });
    try {
      expect(sandboxId).toMatch(/^sbx-/);
      expect(data.envd_access_token).toBeDefined();
      expect((data.envd_access_token as string)).toMatch(/^envd-tok-/);
      expect(data.sandbox_domain).toBe('mock.declaw.dev');
      expect(data.traffic_access_token).toBeDefined();
      expect((data.traffic_access_token as string)).toMatch(/^traffic-/);
    } finally {
      client.close();
    }
  });

  it('should get sandbox info', async () => {
    const { sandboxId, client } = await createSandbox('python');
    try {
      const raw = (await client.get(`/sandboxes/${sandboxId}`)) as Record<string, unknown>;
      const info = parseSandboxInfo(raw);
      expect(info.sandboxId).toBe(sandboxId);
      expect(info.name).toBe('python');
      expect(info.state).toBe(SandboxState.Running);
    } finally {
      client.close();
    }
  });

  it('should check sandbox is running', async () => {
    const { sandboxId, client } = await createSandbox();
    try {
      const raw = (await client.get(`/sandboxes/${sandboxId}/status`)) as Record<string, unknown>;
      expect(raw.is_running).toBe(true);
    } finally {
      client.close();
    }
  });

  it('should set timeout', async () => {
    const { sandboxId, client } = await createSandbox();
    try {
      await client.patch(`/sandboxes/${sandboxId}/timeout`, {
        json: { timeout: 1200 },
      });
      // Verify the timeout was updated by getting sandbox info
      const raw = (await client.get(`/sandboxes/${sandboxId}`)) as Record<string, unknown>;
      expect(raw.timeout).toBe(1200);
    } finally {
      client.close();
    }
  });

  it('should get metrics', async () => {
    const { sandboxId, client } = await createSandbox();
    try {
      const raw = (await client.get(`/sandboxes/${sandboxId}/metrics`)) as Record<string, unknown>[];
      expect(raw).toHaveLength(1);
      const metrics = parseSandboxMetrics(raw[0]);
      expect(metrics.cpuUsagePercent).toBe(12.5);
      expect(metrics.memoryUsageMb).toBe(128.0);
      expect(metrics.diskUsageMb).toBe(50.0);
      expect(metrics.timestamp).toBeInstanceOf(Date);
    } finally {
      client.close();
    }
  });

  it('should pause sandbox', async () => {
    const { sandboxId, client } = await createSandbox();
    try {
      await client.post(`/sandboxes/${sandboxId}/pause`);
      const raw = (await client.get(`/sandboxes/${sandboxId}/status`)) as Record<string, unknown>;
      expect(raw.is_running).toBe(false);
    } finally {
      client.close();
    }
  });

  it('should create snapshot', async () => {
    const { sandboxId, client } = await createSandbox();
    try {
      const raw = (await client.post(`/sandboxes/${sandboxId}/snapshots`)) as Record<string, unknown>;
      const snapshot = parseSnapshotInfo(raw);
      expect(snapshot.snapshotId).toMatch(/^snap-/);
      expect(snapshot.sandboxId).toBe(sandboxId);
      expect(snapshot.createdAt).toBeInstanceOf(Date);
    } finally {
      client.close();
    }
  });

  it('should kill sandbox', async () => {
    const { sandboxId, client } = await createSandbox();
    try {
      const raw = (await client.delete(`/sandboxes/${sandboxId}`)) as Record<string, unknown>;
      expect(raw.killed).toBe(true);
      const status = (await client.get(`/sandboxes/${sandboxId}/status`)) as Record<string, unknown>;
      expect(status.is_running).toBe(false);
    } finally {
      client.close();
    }
  });

  it('should list sandboxes', async () => {
    const s1 = await createSandbox('list-1');
    const s2 = await createSandbox('list-2');
    const client = new ApiClient(config, { maxRetries: 1, retryDelay: 0 });
    try {
      const raw = (await client.get('/sandboxes')) as Record<string, unknown>;
      const sandboxes = raw.sandboxes as Record<string, unknown>[];
      expect(sandboxes.length).toBeGreaterThanOrEqual(2);
      const ids = sandboxes.map((s) => s.sandbox_id);
      expect(ids).toContain(s1.sandboxId);
      expect(ids).toContain(s2.sandboxId);
    } finally {
      s1.client.close();
      s2.client.close();
      client.close();
    }
  });

  it('should connect to existing sandbox (get by id)', async () => {
    const { sandboxId, data: original, client } = await createSandbox('connect-test');
    try {
      const raw = (await client.get(`/sandboxes/${sandboxId}`)) as Record<string, unknown>;
      expect(raw.sandbox_id).toBe(sandboxId);
      expect(raw.envd_access_token).toBe(original.envd_access_token);
      expect(raw.sandbox_domain).toBe(original.sandbox_domain);
    } finally {
      client.close();
    }
  });

  it('should handle full lifecycle: create -> info -> pause -> kill', async () => {
    const { sandboxId, client } = await createSandbox('lifecycle');
    try {
      // Info
      const info = parseSandboxInfo(
        (await client.get(`/sandboxes/${sandboxId}`)) as Record<string, unknown>,
      );
      expect(info.state).toBe(SandboxState.Running);

      // Pause
      await client.post(`/sandboxes/${sandboxId}/pause`);
      const infoAfterPause = parseSandboxInfo(
        (await client.get(`/sandboxes/${sandboxId}`)) as Record<string, unknown>,
      );
      expect(infoAfterPause.state).toBe(SandboxState.Paused);

      // Kill
      const killResult = (await client.delete(`/sandboxes/${sandboxId}`)) as Record<string, unknown>;
      expect(killResult.killed).toBe(true);

      // Status after kill
      const status = (await client.get(`/sandboxes/${sandboxId}/status`)) as Record<string, unknown>;
      expect(status.is_running).toBe(false);
    } finally {
      client.close();
    }
  });
});
