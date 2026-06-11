import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { Volumes } from '../../../src/volumes/volumes.js';
import {
  InvalidArgumentError,
  ConflictError,
  NotEnoughSpaceError,
} from '../../../src/errors.js';

const BASE_URL = 'http://localhost:9999';
const OPTS = { domain: 'localhost:9999', apiKey: 'test-key' };

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('VolumeFiles.write', () => {
  it('PUTs raw bytes to /files/raw with path query, octet-stream, no if_version', async () => {
    let capturedUrl = '';
    let capturedCT = '';
    let capturedBody: Uint8Array | null = null;
    server.use(
      http.put(`${BASE_URL}/volumes/vol-1/files/raw`, async ({ request }) => {
        capturedUrl = request.url;
        capturedCT = request.headers.get('content-type') ?? '';
        capturedBody = new Uint8Array(await request.arrayBuffer());
        return HttpResponse.json({ path: '/a.txt' });
      }),
    );
    const out = await Volumes.files('vol-1', OPTS).write('/a.txt', new Uint8Array([1, 2, 3]));
    const u = new URL(capturedUrl);
    expect(u.pathname).toBe('/volumes/vol-1/files/raw');
    expect(u.searchParams.get('path')).toBe('/a.txt');
    expect(u.searchParams.has('if_version')).toBe(false);
    expect(capturedCT.toLowerCase()).toContain('application/octet-stream');
    expect(Array.from(capturedBody!)).toEqual([1, 2, 3]);
    expect(out).toBe('/a.txt');
  });

  it('sends if_version query when ifVersion is provided (CAS)', async () => {
    let capturedUrl = '';
    server.use(
      http.put(`${BASE_URL}/volumes/vol-1/files/raw`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ path: '/a.txt' });
      }),
    );
    await Volumes.files('vol-1', OPTS).write('/a.txt', new Uint8Array([9]), {
      ifVersion: 'v42',
    });
    expect(new URL(capturedUrl).searchParams.get('if_version')).toBe('v42');
  });

  it('surfaces a 409 CAS version mismatch as ConflictError', async () => {
    server.use(
      http.put(`${BASE_URL}/volumes/vol-1/files/raw`, () =>
        HttpResponse.json({ message: 'version mismatch' }, { status: 409 }),
      ),
    );
    await expect(
      Volumes.files('vol-1', OPTS).write('/a.txt', new Uint8Array([1]), { ifVersion: 'stale' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('surfaces a 413 quota error as NotEnoughSpaceError', async () => {
    server.use(
      http.put(`${BASE_URL}/volumes/vol-1/files/raw`, () =>
        HttpResponse.json({ message: 'quota' }, { status: 413 }),
      ),
    );
    await expect(
      Volumes.files('vol-1', OPTS).write('/a.txt', new Uint8Array([1])),
    ).rejects.toBeInstanceOf(NotEnoughSpaceError);
  });

  it('accepts an ArrayBuffer body', async () => {
    let capturedBody: Uint8Array | null = null;
    server.use(
      http.put(`${BASE_URL}/volumes/vol-1/files/raw`, async ({ request }) => {
        capturedBody = new Uint8Array(await request.arrayBuffer());
        return HttpResponse.json({ path: '/b.bin' });
      }),
    );
    await Volumes.files('vol-1', OPTS).write('/b.bin', new Uint8Array([0xff, 0x00]).buffer);
    expect(Array.from(capturedBody!)).toEqual([0xff, 0x00]);
  });
});

describe('VolumeFiles.read', () => {
  it('GETs /files/raw and returns raw bytes', async () => {
    let capturedUrl = '';
    const payload = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    server.use(
      http.get(`${BASE_URL}/volumes/vol-1/files/raw`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.arrayBuffer(payload.buffer, {
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      }),
    );
    const out = await Volumes.files('vol-1', OPTS).read('/img.png');
    const u = new URL(capturedUrl);
    expect(u.pathname).toBe('/volumes/vol-1/files/raw');
    expect(u.searchParams.get('path')).toBe('/img.png');
    expect(Array.from(out)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe('VolumeFiles.list', () => {
  it('GETs /files/list with path query and parses entries', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE_URL}/volumes/vol-1/files/list`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({
          entries: [
            {
              name: 'a.txt',
              path: '/dir/a.txt',
              is_dir: false,
              size: 12,
              mod_time: '2026-01-01T00:00:00Z',
              mode: 420,
            },
            {
              name: 'sub',
              path: '/dir/sub',
              is_dir: true,
              size: 0,
              mod_time: '2026-01-02T00:00:00Z',
              mode: 493,
            },
          ],
        });
      }),
    );
    const entries = await Volumes.files('vol-1', OPTS).list('/dir');
    expect(new URL(capturedUrl).searchParams.get('path')).toBe('/dir');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      name: 'a.txt',
      path: '/dir/a.txt',
      isDir: false,
      size: 12,
      modTime: '2026-01-01T00:00:00Z',
      mode: 420,
    });
    expect(entries[1].isDir).toBe(true);
  });
});

describe('VolumeFiles.info', () => {
  it('GETs /files/info with path query and parses entry + version', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE_URL}/volumes/vol-1/files/info`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({
          name: 'a.txt',
          path: '/a.txt',
          is_dir: false,
          size: 5,
          mod_time: '2026-01-01T00:00:00Z',
          mode: 420,
          version: 'cas-token-1',
        });
      }),
    );
    const info = await Volumes.files('vol-1', OPTS).info('/a.txt');
    expect(new URL(capturedUrl).searchParams.get('path')).toBe('/a.txt');
    expect(info.version).toBe('cas-token-1');
    expect(info.size).toBe(5);
    expect(info.isDir).toBe(false);
  });
});

describe('VolumeFiles.exists', () => {
  it('GETs /files/exists and returns the boolean', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE_URL}/volumes/vol-1/files/exists`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ exists: true });
      }),
    );
    const ok = await Volumes.files('vol-1', OPTS).exists('/a.txt');
    expect(new URL(capturedUrl).searchParams.get('path')).toBe('/a.txt');
    expect(ok).toBe(true);
  });
});

describe('VolumeFiles.remove', () => {
  it('DELETEs /files with path + recursive=false by default', async () => {
    let capturedUrl = '';
    server.use(
      http.delete(`${BASE_URL}/volumes/vol-1/files`, ({ request }) => {
        capturedUrl = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await Volumes.files('vol-1', OPTS).remove('/a.txt');
    const u = new URL(capturedUrl);
    expect(u.pathname).toBe('/volumes/vol-1/files');
    expect(u.searchParams.get('path')).toBe('/a.txt');
    expect(u.searchParams.get('recursive')).toBe('false');
  });

  it('passes recursive=true when requested', async () => {
    let capturedUrl = '';
    server.use(
      http.delete(`${BASE_URL}/volumes/vol-1/files`, ({ request }) => {
        capturedUrl = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await Volumes.files('vol-1', OPTS).remove('/dir', { recursive: true });
    expect(new URL(capturedUrl).searchParams.get('recursive')).toBe('true');
  });
});

describe('VolumeFiles.rename', () => {
  it('PATCHes /files with old_path/new_path body and parses response', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedUrl = '';
    server.use(
      http.patch(`${BASE_URL}/volumes/vol-1/files`, async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ old_path: '/a.txt', new_path: '/b.txt' });
      }),
    );
    const out = await Volumes.files('vol-1', OPTS).rename('/a.txt', '/b.txt');
    expect(new URL(capturedUrl).pathname).toBe('/volumes/vol-1/files');
    expect(capturedBody).toEqual({ old_path: '/a.txt', new_path: '/b.txt' });
    expect(out).toEqual({ oldPath: '/a.txt', newPath: '/b.txt' });
  });
});

describe('VolumeFiles.mkdir', () => {
  it('POSTs /files/mkdir with path body, returns path', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedUrl = '';
    server.use(
      http.post(`${BASE_URL}/volumes/vol-1/files/mkdir`, async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ path: '/newdir' }, { status: 201 });
      }),
    );
    const out = await Volumes.files('vol-1', OPTS).mkdir('/newdir');
    expect(new URL(capturedUrl).pathname).toBe('/volumes/vol-1/files/mkdir');
    expect(capturedBody).toEqual({ path: '/newdir' });
    expect(out).toBe('/newdir');
  });
});

describe('VolumeFiles validation', () => {
  it('throws InvalidArgumentError on a malformed volume ID', () => {
    expect(() => Volumes.files('bad/id', OPTS)).toThrow(InvalidArgumentError);
  });

  it('throws InvalidArgumentError on an empty path', async () => {
    await expect(Volumes.files('vol-1', OPTS).read('')).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('surfaces a 409 (tarball-backed volume) as ConflictError on list', async () => {
    server.use(
      http.get(`${BASE_URL}/volumes/vol-1/files/list`, () =>
        HttpResponse.json({ message: 'not a file-granular volume' }, { status: 409 }),
      ),
    );
    await expect(Volumes.files('vol-1', OPTS).list('/')).rejects.toBeInstanceOf(ConflictError);
  });
});
