import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { Sandbox } from '../../../src/sandbox/sandbox.js';
import { parseSnapshot } from '../../../src/sandbox/models.js';

const BASE_URL = 'http://localhost:9999';

const CREATE_RESPONSE = {
  sandbox_id: 'sbx-snap',
  envd_access_token: 'envd-snap-tok',
  sandbox_domain: 'sandboxes.example.com',
  traffic_access_token: 'traffic-snap-tok',
};

const CONNECT_RESPONSE = {
  sandbox_id: 'sbx-snap',
  template_id: 'base',
  name: 'restored-sandbox',
  metadata: {},
  state: 'running',
  envd_access_token: 'envd-restored-tok',
  sandbox_domain: 'sandboxes.example.com',
  traffic_access_token: 'traffic-restored-tok',
};

const SNAPSHOT_RESP = {
  snapshot_id: 'snap-manual-001',
  sandbox_id: 'sbx-snap',
  source: 'manual',
  mem_blob_key: 'sandbox/sbx-snap/manual/snap-manual-001/mem',
  vmstate_blob_key: 'sandbox/sbx-snap/manual/snap-manual-001/vmstate',
  mem_size_bytes: 134217728,
  pause_duration_ms: 42,
  created_at: '2026-04-07T10:00:00Z',
};

const LIST_RESP = {
  snapshots: [
    {
      snapshot_id: 'snap-pause-001',
      sandbox_id: 'sbx-snap',
      source: 'pause',
      mem_blob_key: 'sandbox/sbx-snap/pause/mem',
      vmstate_blob_key: 'sandbox/sbx-snap/pause/vmstate',
      mem_size_bytes: 67108864,
      pause_duration_ms: 30,
      created_at: '2026-04-07T09:55:00Z',
    },
    {
      snapshot_id: 'snap-manual-001',
      sandbox_id: 'sbx-snap',
      source: 'manual',
      mem_blob_key: 'sandbox/sbx-snap/manual/snap-manual-001/mem',
      vmstate_blob_key: 'sandbox/sbx-snap/manual/snap-manual-001/vmstate',
      mem_size_bytes: 134217728,
      pause_duration_ms: 42,
      created_at: '2026-04-07T10:00:00Z',
    },
  ],
};

const RESTORE_RESP = {
  sandbox_id: 'sbx-snap',
  node_id: 'node-2',
  snapshot_id: 'snap-manual-001',
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Sandbox snapshot methods', () => {
  // ---- snapshot() ----

  describe('snapshot()', () => {
    it('sends POST /sandboxes/:id/snapshot with empty body and returns Snapshot', async () => {
      let capturedBody: unknown = undefined;
      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
        http.post(`${BASE_URL}/sandboxes/sbx-snap/snapshot`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json(SNAPSHOT_RESP);
        }),
      );

      const sandbox = await Sandbox.create({ apiKey: 'test-key', domain: 'localhost:9999' });
      const snap = await sandbox.snapshot();

      expect(snap.snapshotId).toBe('snap-manual-001');
      expect(snap.sandboxId).toBe('sbx-snap');
      expect(snap.source).toBe('manual');
      expect(snap.memBlobKey).toBe('sandbox/sbx-snap/manual/snap-manual-001/mem');
      expect(snap.vmstateBlobKey).toBe('sandbox/sbx-snap/manual/snap-manual-001/vmstate');
      expect(snap.memSizeBytes).toBe(134217728);
      expect(snap.pauseDurationMs).toBe(42);
      expect(snap.createdAt).toBe('2026-04-07T10:00:00Z');
      // Body should be an empty object
      expect(capturedBody).toEqual({});
      sandbox.close();
    });
  });

  // ---- listSnapshots() ----

  describe('listSnapshots()', () => {
    it('sends GET /sandboxes/:id/snapshots and unpacks the snapshots array', async () => {
      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
        http.get(`${BASE_URL}/sandboxes/sbx-snap/snapshots`, () =>
          HttpResponse.json(LIST_RESP),
        ),
      );

      const sandbox = await Sandbox.create({ apiKey: 'test-key', domain: 'localhost:9999' });
      const snaps = await sandbox.listSnapshots();

      expect(snaps).toHaveLength(2);
      expect(snaps[0].snapshotId).toBe('snap-pause-001');
      expect(snaps[0].source).toBe('pause');
      expect(snaps[1].snapshotId).toBe('snap-manual-001');
      expect(snaps[1].source).toBe('manual');
      sandbox.close();
    });

    it('returns empty array when snapshots list is empty', async () => {
      server.use(
        http.post(`${BASE_URL}/sandboxes`, () => HttpResponse.json(CREATE_RESPONSE)),
        http.get(`${BASE_URL}/sandboxes/sbx-snap/snapshots`, () =>
          HttpResponse.json({ snapshots: [] }),
        ),
      );

      const sandbox = await Sandbox.create({ apiKey: 'test-key', domain: 'localhost:9999' });
      const snaps = await sandbox.listSnapshots();

      expect(snaps).toHaveLength(0);
      sandbox.close();
    });
  });

  // ---- restore() ----

  describe('restore()', () => {
    it('sends POST /sandboxes/:id/restore with no query param when snapshotId is omitted', async () => {
      let capturedRestoreUrl = '';
      server.use(
        http.post(`${BASE_URL}/sandboxes/sbx-snap/restore`, ({ request }) => {
          capturedRestoreUrl = request.url;
          return HttpResponse.json(RESTORE_RESP);
        }),
        http.get(`${BASE_URL}/sandboxes/sbx-snap`, () => HttpResponse.json(CONNECT_RESPONSE)),
      );

      const sandbox = await Sandbox.restore('sbx-snap', {
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });

      const url = new URL(capturedRestoreUrl);
      expect(url.searchParams.has('snapshot_id')).toBe(false);
      expect(sandbox.sandboxId).toBe('sbx-snap');
      sandbox.close();
    });

    it('sends POST /sandboxes/:id/restore?snapshot_id=... when snapshotId is provided', async () => {
      let capturedRestoreUrl = '';
      server.use(
        http.post(`${BASE_URL}/sandboxes/sbx-snap/restore`, ({ request }) => {
          capturedRestoreUrl = request.url;
          return HttpResponse.json(RESTORE_RESP);
        }),
        http.get(`${BASE_URL}/sandboxes/sbx-snap`, () => HttpResponse.json(CONNECT_RESPONSE)),
      );

      const sandbox = await Sandbox.restore('sbx-snap', {
        snapshotId: 'snap-manual-001',
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });

      const url = new URL(capturedRestoreUrl);
      expect(url.searchParams.get('snapshot_id')).toBe('snap-manual-001');
      expect(sandbox.sandboxId).toBe('sbx-snap');
      sandbox.close();
    });

    it('returns a Sandbox instance with server-provided tokens', async () => {
      server.use(
        http.post(`${BASE_URL}/sandboxes/sbx-snap/restore`, () =>
          HttpResponse.json(RESTORE_RESP),
        ),
        http.get(`${BASE_URL}/sandboxes/sbx-snap`, () => HttpResponse.json(CONNECT_RESPONSE)),
      );

      const sandbox = await Sandbox.restore('sbx-snap', {
        apiKey: 'test-key',
        domain: 'localhost:9999',
      });

      expect(sandbox.sandboxId).toBe('sbx-snap');
      expect(sandbox.envdAccessToken).toBe('envd-restored-tok');
      expect(sandbox.sandboxDomain).toBe('sandboxes.example.com');
      sandbox.close();
    });
  });
});

// ---- parseSnapshot() ----

describe('parseSnapshot()', () => {
  it('maps snake_case fields correctly', () => {
    const snap = parseSnapshot(SNAPSHOT_RESP);
    expect(snap.snapshotId).toBe('snap-manual-001');
    expect(snap.sandboxId).toBe('sbx-snap');
    expect(snap.source).toBe('manual');
    expect(snap.memBlobKey).toBe('sandbox/sbx-snap/manual/snap-manual-001/mem');
    expect(snap.vmstateBlobKey).toBe('sandbox/sbx-snap/manual/snap-manual-001/vmstate');
    expect(snap.memSizeBytes).toBe(134217728);
    expect(snap.pauseDurationMs).toBe(42);
    expect(snap.createdAt).toBe('2026-04-07T10:00:00Z');
  });

  it('handles absent optional fields gracefully', () => {
    const snap = parseSnapshot({
      snapshot_id: 'snap-x',
      sandbox_id: 'sbx-y',
      source: 'periodic',
      created_at: '2026-04-07T10:00:00Z',
    });
    expect(snap.memBlobKey).toBe('');
    expect(snap.vmstateBlobKey).toBe('');
    expect(snap.memSizeBytes).toBeUndefined();
    expect(snap.pauseDurationMs).toBeUndefined();
  });
});
