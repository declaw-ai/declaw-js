import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { Volumes } from '../../../src/volumes/volumes.js';
import { volumeAttachmentToJSON } from '../../../src/volumes/models.js';
import { InvalidArgumentError, NotEnoughSpaceError } from '../../../src/errors.js';

const BASE_URL = 'http://localhost:9999';
const OPTS = { domain: 'localhost:9999', apiKey: 'test-key' };

const COMMIT_RESP = {
  volume_id: 'vol-new',
  owner_id: 'owner-1',
  name: 'snapshot',
  blob_key: 'volumes/owner-1/vol-new',
  size_bytes: 2048,
  content_type: 'application/gzip',
  created_at: '2026-01-01T00:00:00Z',
  backend: 'tarball',
  quota_bytes: 1073741824,
  updated_at: '2026-01-02T00:00:00Z',
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Volumes.commit', () => {
  it('posts to the commit route with a name query param', async () => {
    let capturedUrl = '';
    server.use(
      http.post(`${BASE_URL}/sandboxes/sbx-1/volumes/vol-src/commit`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(COMMIT_RESP, { status: 201 });
      }),
    );

    const vol = await Volumes.commit('sbx-1', 'vol-src', 'snapshot', OPTS);

    expect(new URL(capturedUrl).searchParams.get('name')).toBe('snapshot');
    expect(vol.volumeId).toBe('vol-new');
    expect(vol.name).toBe('snapshot');
    expect(vol.sizeBytes).toBe(2048);
  });

  it('omits the name query param when name is not provided', async () => {
    let capturedUrl = '';
    server.use(
      http.post(`${BASE_URL}/sandboxes/sbx-1/volumes/vol-src/commit`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ ...COMMIT_RESP, name: 'src-commit' }, { status: 201 });
      }),
    );

    const vol = await Volumes.commit('sbx-1', 'vol-src', undefined, OPTS);

    expect(new URL(capturedUrl).searchParams.has('name')).toBe(false);
    expect(vol.name).toBe('src-commit');
  });

  it('throws InvalidArgumentError on a malformed sandbox ID', async () => {
    await expect(Volumes.commit('bad/id', 'vol-src', undefined, OPTS)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('throws InvalidArgumentError on a malformed volume ID', async () => {
    await expect(Volumes.commit('sbx-1', 'bad/id', undefined, OPTS)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects when the sandbox is paused (409)', async () => {
    server.use(
      http.post(`${BASE_URL}/sandboxes/sbx-1/volumes/vol-src/commit`, () =>
        HttpResponse.json({ message: 'sandbox is paused' }, { status: 409 }),
      ),
    );

    await expect(Volumes.commit('sbx-1', 'vol-src', undefined, OPTS)).rejects.toThrow();
  });

  it('rejects when the volume is not attached (400)', async () => {
    server.use(
      http.post(`${BASE_URL}/sandboxes/sbx-1/volumes/vol-src/commit`, () =>
        HttpResponse.json({ message: 'volume is not attached to this sandbox' }, { status: 400 }),
      ),
    );

    await expect(Volumes.commit('sbx-1', 'vol-src', undefined, OPTS)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });
});

describe('volumeAttachmentToJSON (attach mode/subpath)', () => {
  it('emits only volume_id + mount_path when mode/subpath are unset', () => {
    expect(volumeAttachmentToJSON({ volumeId: 'v1', mountPath: '/data' })).toEqual({
      volume_id: 'v1',
      mount_path: '/data',
    });
  });

  it('emits snake_case mode + subpath when set (live mount)', () => {
    expect(
      volumeAttachmentToJSON({
        volumeId: 'v1',
        mountPath: '/data',
        mode: 'mount-ro',
        subpath: 'sub/dir',
      }),
    ).toEqual({
      volume_id: 'v1',
      mount_path: '/data',
      mode: 'mount-ro',
      subpath: 'sub/dir',
    });
  });

  it('emits mode without subpath', () => {
    expect(
      volumeAttachmentToJSON({ volumeId: 'v1', mountPath: '/data', mode: 'copy' }),
    ).toEqual({ volume_id: 'v1', mount_path: '/data', mode: 'copy' });
  });
});

describe('parseVolumeInfo (parity fields)', () => {
  it('parses backend / quota_bytes / updated_at', async () => {
    server.use(
      http.get(`${BASE_URL}/volumes/vol-1`, () => HttpResponse.json(COMMIT_RESP)),
    );
    const vol = await Volumes.get('vol-1', OPTS);
    expect(vol.backend).toBe('tarball');
    expect(vol.quotaBytes).toBe(1073741824);
    expect(vol.updatedAt).toBe('2026-01-02T00:00:00Z');
  });
});

describe('Volumes.create', () => {
  it('with data POSTs gzip bytes to /volumes with name query + application/gzip', async () => {
    let capturedUrl = '';
    let capturedCT = '';
    let capturedBody: Uint8Array | null = null;
    server.use(
      http.post(`${BASE_URL}/volumes`, async ({ request }) => {
        capturedUrl = request.url;
        capturedCT = request.headers.get('content-type') ?? '';
        capturedBody = new Uint8Array(await request.arrayBuffer());
        return HttpResponse.json(COMMIT_RESP, { status: 201 });
      }),
    );
    const payload = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);
    const vol = await Volumes.create('my-vol', payload, OPTS);
    expect(new URL(capturedUrl).searchParams.get('name')).toBe('my-vol');
    expect(capturedCT.toLowerCase()).toContain('application/gzip');
    expect(Array.from(capturedBody!)).toEqual([0x1f, 0x8b, 0x08, 0x00]);
    expect(vol.volumeId).toBe('vol-new');
  });

  it('without data POSTs to /volumes with no body (empty volume)', async () => {
    let capturedUrl = '';
    let bodyLen = -1;
    server.use(
      http.post(`${BASE_URL}/volumes`, async ({ request }) => {
        capturedUrl = request.url;
        bodyLen = (await request.arrayBuffer()).byteLength;
        return HttpResponse.json(COMMIT_RESP, { status: 201 });
      }),
    );
    const vol = await Volumes.create('scratch', undefined, OPTS);
    expect(new URL(capturedUrl).searchParams.get('name')).toBe('scratch');
    expect(bodyLen).toBe(0);
    expect(vol.volumeId).toBe('vol-new');
  });
});

describe('Volumes.snapshot', () => {
  it('POSTs to the snapshot route with path + name query, no body', async () => {
    let capturedUrl = '';
    let bodyLen = -1;
    server.use(
      http.post(`${BASE_URL}/sandboxes/sbx-1/volumes/snapshot`, async ({ request }) => {
        capturedUrl = request.url;
        bodyLen = (await request.arrayBuffer()).byteLength;
        return HttpResponse.json(COMMIT_RESP, { status: 201 });
      }),
    );
    const vol = await Volumes.snapshot('sbx-1', '/data/work', 'mysnap', OPTS);
    const u = new URL(capturedUrl);
    expect(u.searchParams.get('path')).toBe('/data/work');
    expect(u.searchParams.get('name')).toBe('mysnap');
    expect(bodyLen).toBe(0);
    expect(vol.volumeId).toBe('vol-new');
  });

  it('omits the name query when not provided', async () => {
    let capturedUrl = '';
    server.use(
      http.post(`${BASE_URL}/sandboxes/sbx-1/volumes/snapshot`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(COMMIT_RESP, { status: 201 });
      }),
    );
    await Volumes.snapshot('sbx-1', '/data', undefined, OPTS);
    expect(new URL(capturedUrl).searchParams.has('name')).toBe(false);
  });

  it('throws InvalidArgumentError on missing path', async () => {
    await expect(Volumes.snapshot('sbx-1', '', undefined, OPTS)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('throws InvalidArgumentError on malformed sandbox ID', async () => {
    await expect(Volumes.snapshot('bad/id', '/data', undefined, OPTS)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });
});

describe('Volumes.empty', () => {
  it('POSTs to /volumes/empty with name query and no body', async () => {
    let capturedUrl = '';
    server.use(
      http.post(`${BASE_URL}/volumes/empty`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ ...COMMIT_RESP, backend: 'filegranular' }, { status: 201 });
      }),
    );
    const vol = await Volumes.empty('scratch', OPTS);
    expect(new URL(capturedUrl).pathname).toBe('/volumes/empty');
    expect(new URL(capturedUrl).searchParams.get('name')).toBe('scratch');
    expect(vol.backend).toBe('filegranular');
  });

  it('throws InvalidArgumentError on empty name', async () => {
    await expect(Volumes.empty('', OPTS)).rejects.toBeInstanceOf(InvalidArgumentError);
  });
});

describe('Volumes.ingest', () => {
  it('POSTs tar.gz bytes to /volumes/ingest with name + application/gzip', async () => {
    let capturedUrl = '';
    let capturedCT = '';
    let capturedBody: Uint8Array | null = null;
    server.use(
      http.post(`${BASE_URL}/volumes/ingest`, async ({ request }) => {
        capturedUrl = request.url;
        capturedCT = request.headers.get('content-type') ?? '';
        capturedBody = new Uint8Array(await request.arrayBuffer());
        return HttpResponse.json({ ...COMMIT_RESP, backend: 'filegranular' }, { status: 201 });
      }),
    );
    const payload = new Uint8Array([0x1f, 0x8b]).buffer;
    const vol = await Volumes.ingest('imported', payload, OPTS);
    expect(new URL(capturedUrl).searchParams.get('name')).toBe('imported');
    expect(capturedCT.toLowerCase()).toContain('application/gzip');
    expect(Array.from(capturedBody!)).toEqual([0x1f, 0x8b]);
    expect(vol.backend).toBe('filegranular');
  });

  it('surfaces 413 quota exceeded', async () => {
    server.use(
      http.post(`${BASE_URL}/volumes/ingest`, () =>
        HttpResponse.json({ message: 'quota exceeded' }, { status: 413 }),
      ),
    );
    await expect(
      Volumes.ingest('big', new Uint8Array([1]), OPTS),
    ).rejects.toBeInstanceOf(NotEnoughSpaceError);
  });
});

describe('Volumes.download', () => {
  it('GETs /volumes/{id}/download and returns raw bytes', async () => {
    const blob = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    let capturedUrl = '';
    server.use(
      http.get(`${BASE_URL}/volumes/vol-1/download`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.arrayBuffer(blob.buffer, {
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      }),
    );
    const out = await Volumes.download('vol-1', OPTS);
    expect(new URL(capturedUrl).pathname).toBe('/volumes/vol-1/download');
    expect(Array.from(out)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });
});
