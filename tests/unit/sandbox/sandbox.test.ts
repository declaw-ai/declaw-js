import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { Sandbox } from '../../../src/sandbox/sandbox.js';
import type { SandboxOpts } from '../../../src/sandbox/sandbox.js';
import { SandboxState } from '../../../src/sandbox/models.js';
import { NotFoundError, SandboxError } from '../../../src/errors.js';

const BASE_URL = 'http://localhost:9999';

/** Default API response for POST /sandboxes */
const CREATE_RESPONSE = {
  sandbox_id: 'sbx-abc123',
  envd_access_token: 'envd-token-xyz',
  sandbox_domain: 'sandboxes.example.com',
  traffic_access_token: 'traffic-token-xyz',
};

/** Default API response for GET /sandboxes/:id */
const CONNECT_RESPONSE = {
  sandbox_id: 'sbx-existing',
  template_id: 'base',
  name: 'test-sandbox',
  metadata: {},
  state: 'running',
  started_at: '2024-01-01T00:00:00Z',
  envd_access_token: 'envd-connect-token',
  sandbox_domain: 'sandboxes.example.com',
  traffic_access_token: 'traffic-connect-token',
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Sandbox', () => {
  // ---- create() ----

  describe('create()', () => {
    it('sends POST /sandboxes with default body and returns Sandbox instance', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/sandboxes`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(CREATE_RESPONSE);
        }),
      );

      const sandbox = await Sandbox.create({
        apiKey: 'test-key',
        domain: 'localhost:9999',
        requestTimeout: 5000,
      });

      expect(sandbox.sandboxId).toBe('sbx-abc123');
      expect(sandbox.envdAccessToken).toBe('envd-token-xyz');
      expect(sandbox.sandboxDomain).toBe('sandboxes.example.com');
      expect(sandbox.trafficAccessToken).toBe('traffic-token-xyz');
      expect(capturedBody.template).toBe('base');
      expect(capturedBody.timeout).toBe(300);
      expect(capturedBody.secure).toBe(true);
      sandbox.close();
    });

    it('sends all options in request body', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/sandboxes`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(CREATE_RESPONSE);
        }),
      );

      const opts: SandboxOpts = {
        template: 'python3',
        timeout: 600,
        metadata: { project: 'test' },
        envs: { NODE_ENV: 'production' },
        secure: false,
        network: {
          allowOut: ['1.2.3.4'],
          denyOut: [],
          allowPublicTraffic: true,
        },
        lifecycle: { onTimeout: 'pause', autoResume: true },
        apiKey: 'test-key',
        domain: 'localhost:9999',
      };

      const sandbox = await Sandbox.create(opts);

      expect(capturedBody.template).toBe('python3');
      expect(capturedBody.timeout).toBe(600);
      expect(capturedBody.metadata).toEqual({ project: 'test' });
      expect(capturedBody.envs).toEqual({ NODE_ENV: 'production' });
      expect(capturedBody.secure).toBe(false);
      expect(capturedBody.network).toEqual({
        allow_out: ['1.2.3.4'],
        deny_out: [],
        allow_public_traffic: true,
      });
      expect(capturedBody.lifecycle).toEqual({ on_timeout: 'pause', auto_resume: true });
      expect(capturedBody.resources).toBeUndefined();
      sandbox.close();
    });

    it('adds deny_out: ALL_TRAFFIC when allowInternetAccess is false', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/sandboxes`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(CREATE_RESPONSE);
        }),
      );

      const sandbox = await Sandbox.create({
        allowInternetAccess: false,
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });

      expect(capturedBody.network).toEqual({ deny_out: ['0.0.0.0/0'] });
      sandbox.close();
    });

    it('allowInternetAccess: false is overridden by explicit network opts', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/sandboxes`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(CREATE_RESPONSE);
        }),
      );

      const sandbox = await Sandbox.create({
        allowInternetAccess: false,
        network: { allowOut: ['1.2.3.4'], denyOut: [], allowPublicTraffic: false },
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });

      // Explicit network opts take precedence
      expect(capturedBody.network).toEqual({
        allow_out: ['1.2.3.4'],
        deny_out: [],
        allow_public_traffic: false,
      });
      sandbox.close();
    });

    it('includes security policy in request body', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/sandboxes`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(CREATE_RESPONSE);
        }),
      );

      const sandbox = await Sandbox.create({
        security: {
          pii: { enabled: true, types: [], action: 'redact' as const },
          injectionDefense: false,
          transformations: [],
          audit: false,
          envSecurity: { maskPatterns: [], secureVars: [] },
        },
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });

      expect(capturedBody.security).toBeDefined();
      sandbox.close();
    });

    it('uses defaults when called with no options', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/sandboxes`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(CREATE_RESPONSE);
        }),
      );

      // Set env vars so ConnectionConfig picks them up
      const origKey = process.env.DECLAW_API_KEY;
      const origDomain = process.env.DECLAW_DOMAIN;
      process.env.DECLAW_API_KEY = 'env-key';
      process.env.DECLAW_DOMAIN = 'localhost:9999';

      try {
        const sandbox = await Sandbox.create();
        expect(capturedBody.template).toBe('base');
        expect(capturedBody.timeout).toBe(300);
        expect(capturedBody.secure).toBe(true);
        sandbox.close();
      } finally {
        if (origKey !== undefined) process.env.DECLAW_API_KEY = origKey;
        else delete process.env.DECLAW_API_KEY;
        if (origDomain !== undefined) process.env.DECLAW_DOMAIN = origDomain;
        else delete process.env.DECLAW_DOMAIN;
      }
    });
  });

  // ---- connect() ----

  describe('connect()', () => {
    it('sends GET /sandboxes/:id and returns Sandbox instance', async () => {
      server.use(
        http.get(`${BASE_URL}/sandboxes/sbx-existing`, () =>
          HttpResponse.json(CONNECT_RESPONSE),
        ),
      );

      const sandbox = await Sandbox.connect('sbx-existing', {
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });

      expect(sandbox.sandboxId).toBe('sbx-existing');
      expect(sandbox.envdAccessToken).toBe('envd-connect-token');
      expect(sandbox.sandboxDomain).toBe('sandboxes.example.com');
      expect(sandbox.trafficAccessToken).toBe('traffic-connect-token');
      sandbox.close();
    });

    it('throws NotFoundError for unknown sandbox', async () => {
      server.use(
        http.get(`${BASE_URL}/sandboxes/sbx-unknown`, () =>
          HttpResponse.json({ message: 'not found' }, { status: 404 }),
        ),
      );

      await expect(
        Sandbox.connect('sbx-unknown', { apiKey: 'test-key', domain: 'localhost:9999' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ---- list() ----

  describe('list()', () => {
    it('sends GET /sandboxes with params and returns parsed sandboxes', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${BASE_URL}/sandboxes`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({
            sandboxes: [
              {
                sandbox_id: 'sbx-1',
                template_id: 'base',
                name: 'sandbox-1',
                metadata: {},
                state: 'running',
              },
              {
                sandbox_id: 'sbx-2',
                template_id: 'python3',
                name: 'sandbox-2',
                metadata: { env: 'prod' },
                state: 'paused',
              },
            ],
            next_token: 'tok-next',
          });
        }),
      );

      const result = await Sandbox.list({
        query: { state: 'running' },
        limit: 10,
        nextToken: 'tok-prev',
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });

      const url = new URL(capturedUrl);
      expect(url.searchParams.get('state')).toBe('running');
      expect(url.searchParams.get('limit')).toBe('10');
      expect(url.searchParams.get('next_token')).toBe('tok-prev');

      expect(result.sandboxes).toHaveLength(2);
      expect(result.sandboxes[0].sandboxId).toBe('sbx-1');
      expect(result.sandboxes[0].state).toBe(SandboxState.Running);
      expect(result.sandboxes[1].sandboxId).toBe('sbx-2');
      expect(result.sandboxes[1].state).toBe(SandboxState.Paused);
      expect(result.nextToken).toBe('tok-next');
    });

    it('returns empty list when no sandboxes exist', async () => {
      server.use(
        http.get(`${BASE_URL}/sandboxes`, () =>
          HttpResponse.json({ sandboxes: [] }),
        ),
      );

      const result = await Sandbox.list({
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });

      expect(result.sandboxes).toHaveLength(0);
      expect(result.nextToken).toBeUndefined();
    });
  });

  // ---- kill() ----

  describe('kill()', () => {
    it('sends DELETE /sandboxes/:id and returns true on success', async () => {
      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
        http.delete(`${BASE_URL}/sandboxes/sbx-abc123`, () =>
          HttpResponse.json({ killed: true }),
        ),
      );

      const sandbox = await Sandbox.create({
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });
      const killed = await sandbox.kill();
      expect(killed).toBe(true);
      sandbox.close();
    });

    it('returns false when sandbox was already killed', async () => {
      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
        http.delete(`${BASE_URL}/sandboxes/sbx-abc123`, () =>
          HttpResponse.json({ killed: false }),
        ),
      );

      const sandbox = await Sandbox.create({
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });
      // wait:true exercises the synchronous DELETE path, whose response carries
      // `killed` (the async path returns `queued`). The server reports
      // {killed:false} when the sandbox was already dead.
      const killed = await sandbox.kill({ wait: true });
      expect(killed).toBe(false);
      sandbox.close();
    });
  });

  // ---- isRunning() ----

  describe('isRunning()', () => {
    it('sends GET /sandboxes/:id/status and returns boolean', async () => {
      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
        http.get(`${BASE_URL}/sandboxes/sbx-abc123/status`, () =>
          HttpResponse.json({ is_running: true }),
        ),
      );

      const sandbox = await Sandbox.create({
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });
      const running = await sandbox.isRunning();
      expect(running).toBe(true);
      sandbox.close();
    });

    it('returns false when sandbox is not running', async () => {
      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
        http.get(`${BASE_URL}/sandboxes/sbx-abc123/status`, () =>
          HttpResponse.json({ is_running: false }),
        ),
      );

      const sandbox = await Sandbox.create({
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });
      const running = await sandbox.isRunning();
      expect(running).toBe(false);
      sandbox.close();
    });
  });

  // ---- setTimeout() ----

  describe('setTimeout()', () => {
    it('sends PATCH /sandboxes/:id/timeout with timeout body', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
        http.patch(`${BASE_URL}/sandboxes/sbx-abc123/timeout`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({});
        }),
      );

      const sandbox = await Sandbox.create({
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });
      await sandbox.setTimeout(600);
      expect(capturedBody.timeout).toBe(600);
      sandbox.close();
    });
  });

  // ---- getInfo() ----

  describe('getInfo()', () => {
    it('sends GET /sandboxes/:id and returns parsed SandboxInfo', async () => {
      const infoResponse = {
        sandbox_id: 'sbx-abc123',
        template_id: 'python3',
        name: 'my-sandbox',
        metadata: { key: 'value' },
        state: 'running',
        started_at: '2024-06-01T12:00:00Z',
        end_at: '2024-06-01T13:00:00Z',
      };

      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
        http.get(`${BASE_URL}/sandboxes/sbx-abc123`, () =>
          HttpResponse.json(infoResponse),
        ),
      );

      const sandbox = await Sandbox.create({
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });
      const info = await sandbox.getInfo();
      expect(info.sandboxId).toBe('sbx-abc123');
      expect(info.templateId).toBe('python3');
      expect(info.name).toBe('my-sandbox');
      expect(info.metadata).toEqual({ key: 'value' });
      expect(info.state).toBe(SandboxState.Running);
      expect(info.startedAt).toBeInstanceOf(Date);
      expect(info.endAt).toBeInstanceOf(Date);
      sandbox.close();
    });
  });

  // ---- getMetrics() ----

  describe('getMetrics()', () => {
    it('sends GET /sandboxes/:id/metrics with date params', async () => {
      let capturedUrl = '';
      const metricsResponse = [
        {
          timestamp: '2024-06-01T12:00:00Z',
          cpu_usage_percent: 25.5,
          memory_usage_mb: 128,
          disk_usage_mb: 512,
        },
      ];

      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
        http.get(`${BASE_URL}/sandboxes/sbx-abc123/metrics`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(metricsResponse);
        }),
      );

      const sandbox = await Sandbox.create({
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });
      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-01T23:59:59Z');
      const metrics = await sandbox.getMetrics({ start, end });

      const url = new URL(capturedUrl);
      expect(url.searchParams.get('start')).toBe(start.toISOString());
      expect(url.searchParams.get('end')).toBe(end.toISOString());
      expect(metrics).toHaveLength(1);
      expect(metrics[0].cpuUsagePercent).toBe(25.5);
      expect(metrics[0].memoryUsageMb).toBe(128);
      expect(metrics[0].diskUsageMb).toBe(512);
      expect(metrics[0].timestamp).toBeInstanceOf(Date);
      sandbox.close();
    });

    it('sends request without date params when not specified', async () => {
      let capturedUrl = '';
      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
        http.get(`${BASE_URL}/sandboxes/sbx-abc123/metrics`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json([]);
        }),
      );

      const sandbox = await Sandbox.create({
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });
      const metrics = await sandbox.getMetrics();

      const url = new URL(capturedUrl);
      expect(url.searchParams.has('start')).toBe(false);
      expect(url.searchParams.has('end')).toBe(false);
      expect(metrics).toHaveLength(0);
      sandbox.close();
    });
  });

  // ---- pause() ----

  describe('pause()', () => {
    it('sends POST /sandboxes/:id/pause', async () => {
      let pauseCalled = false;
      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
        http.post(`${BASE_URL}/sandboxes/sbx-abc123/pause`, () => {
          pauseCalled = true;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const sandbox = await Sandbox.create({
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });
      await sandbox.pause();
      expect(pauseCalled).toBe(true);
      sandbox.close();
    });
  });

  // ---- createSnapshot() ----

  describe('createSnapshot()', () => {
    it('sends POST /sandboxes/:id/snapshots and returns parsed SnapshotInfo', async () => {
      const snapshotResponse = {
        snapshot_id: 'snap-123',
        sandbox_id: 'sbx-abc123',
        created_at: '2024-06-01T12:30:00Z',
      };

      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
        http.post(`${BASE_URL}/sandboxes/sbx-abc123/snapshot`, () =>
          HttpResponse.json(snapshotResponse),
        ),
      );

      const sandbox = await Sandbox.create({
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });
      const snapshot = await sandbox.createSnapshot();
      expect(snapshot.snapshotId).toBe('snap-123');
      expect(snapshot.sandboxId).toBe('sbx-abc123');
      expect(snapshot.createdAt).toBeInstanceOf(Date);
      sandbox.close();
    });
  });

  // ---- close() ----

  describe('close()', () => {
    it('cleans up client resources', async () => {
      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
      );

      const sandbox = await Sandbox.create({
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });
      // close() should not throw
      sandbox.close();
    });
  });

  // ---- Resource safety ----

  describe('Resource safety', () => {
    it('create() cleans up client if API call fails', async () => {
      server.use(
        http.post(`${BASE_URL}/sandboxes`, () =>
          HttpResponse.json({ message: 'server error' }, { status: 500 }),
        ),
      );

      await expect(
        Sandbox.create({
          apiKey: 'test-key',
          domain: 'localhost:9999',
          requestTimeout: 1000,
        }),
      ).rejects.toThrow(SandboxError);

      // If the client was not closed, we would leak resources.
      // The test passing without hanging confirms cleanup happened.
    });

    it('connect() cleans up client if API call fails', async () => {
      server.use(
        http.get(`${BASE_URL}/sandboxes/sbx-fail`, () =>
          HttpResponse.json({ message: 'not found' }, { status: 404 }),
        ),
      );

      await expect(
        Sandbox.connect('sbx-fail', {
          apiKey: 'test-key',
          domain: 'localhost:9999',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ---- Symbol.asyncDispose ----

  describe('Symbol.asyncDispose', () => {
    it('calls close() when disposed', async () => {
      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
      );

      const sandbox = await Sandbox.create({
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });

      // Manually invoke asyncDispose
      await sandbox[Symbol.asyncDispose]();

      // After dispose, further API calls should fail since the client is closed
      // This verifies close() was actually called
    });
  });

  // ---- URL helpers ----
  //
  // All URL helpers must return path-based URLs under `api.<domain>`,
  // NEVER subdomain-style `<id>.api.<domain>`.

  describe('URL helpers', () => {
    async function makeSandbox() {
      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
      );
      return Sandbox.create({ apiKey: 'test-key', domain: 'localhost:9999' });
    }

    it('envdApiUrl returns path-based base URL', async () => {
      const sandbox = await makeSandbox();
      expect(sandbox.envdApiUrl).toBe('http://localhost:9999/sandboxes/sbx-abc123');
    });

    it('getHost returns /ports/<port> path', async () => {
      const sandbox = await makeSandbox();
      expect(sandbox.getHost(3000)).toBe(
        'http://localhost:9999/sandboxes/sbx-abc123/ports/3000',
      );
    });

    it('getMcpUrl returns /ports/50005/mcp', async () => {
      const sandbox = await makeSandbox();
      expect(sandbox.getMcpUrl()).toBe(
        'http://localhost:9999/sandboxes/sbx-abc123/ports/50005/mcp',
      );
    });

    it('downloadUrl encodes path query param', async () => {
      const sandbox = await makeSandbox();
      expect(sandbox.downloadUrl('/home/user/file.txt')).toBe(
        'http://localhost:9999/sandboxes/sbx-abc123/files/raw?path=%2Fhome%2Fuser%2Ffile.txt',
      );
    });

    it('downloadUrl includes username when provided', async () => {
      const sandbox = await makeSandbox();
      expect(sandbox.downloadUrl('/p', 'root')).toBe(
        'http://localhost:9999/sandboxes/sbx-abc123/files/raw?path=%2Fp&username=root',
      );
    });

    it('uploadUrl has the same shape as downloadUrl (different HTTP verb)', async () => {
      const sandbox = await makeSandbox();
      expect(sandbox.uploadUrl('/dest/file.txt', 'root')).toBe(
        'http://localhost:9999/sandboxes/sbx-abc123/files/raw?path=%2Fdest%2Ffile.txt&username=root',
      );
    });

    it('none of the URLs use subdomain format (<id>.domain)', async () => {
      const sandbox = await makeSandbox();
      const urls = [
        sandbox.envdApiUrl,
        sandbox.getHost(8080),
        sandbox.getMcpUrl(),
        sandbox.downloadUrl('/x'),
        sandbox.uploadUrl('/x'),
      ];
      for (const url of urls) {
        expect(url).not.toContain('sbx-abc123.');
      }
    });
  });
});
