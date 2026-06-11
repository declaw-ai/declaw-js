import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { ApiClient } from '../../../../src/api/client.js';
import { ConnectionConfig } from '../../../../src/connectionConfig.js';
import { Filesystem } from '../../../../src/sandbox/filesystem/filesystem.js';
import { FileType } from '../../../../src/sandbox/filesystem/models.js';

const BASE_URL = 'http://localhost:9998';
const SANDBOX_ID = 'sbx-test-123';

function makeClient(): ApiClient {
  const config = new ConnectionConfig({
    apiKey: 'test-key',
    apiUrl: BASE_URL,
    requestTimeout: 5000,
  });
  return new ApiClient(config, { maxRetries: 1, retryDelay: 0 });
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Filesystem', () => {
  // ---- read ----

  it('read() sends GET with correct params and returns text', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.text('file contents here');
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    const result = await fs.read('/tmp/test.txt');

    const url = new URL(capturedUrl);
    expect(url.searchParams.get('path')).toBe('/tmp/test.txt');
    expect(url.searchParams.get('username')).toBe('user');
    expect(result).toBe('file contents here');
    client.close();
  });

  // ---- write ----

  it('write() with string data sends correct body', async () => {
    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ path: '/tmp/out.txt', size: 11 });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    const result = await fs.write('/tmp/out.txt', 'hello world');

    expect(capturedBody).toEqual({ path: '/tmp/out.txt', data: 'hello world', username: 'user' });
    expect(result).toEqual({ path: '/tmp/out.txt', size: 11 });
    client.close();
  });

  // ---- write() binary (pinned against U+FFFD corruption bug) ----
  // Pre-fix, Uint8Array was lossy-decoded via `new TextDecoder().decode(data)`
  // before being placed into a JSON string — every non-UTF-8 byte became
  // U+FFFD (0xEF 0xBF 0xBD on the wire). The SDK now dispatches Uint8Array
  // payloads to PUT /files/raw (Content-Type: application/octet-stream).

  it('write() with Uint8Array routes to PUT /files/raw, byte-identical', async () => {
    let capturedUrl = '';
    let capturedContentType = '';
    let capturedBody: Uint8Array | null = null;
    server.use(
      http.put(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/raw`, async ({ request }) => {
        capturedUrl = request.url;
        capturedContentType = request.headers.get('content-type') ?? '';
        capturedBody = new Uint8Array(await request.arrayBuffer());
        return HttpResponse.json({ path: '/tmp/img.png', size: capturedBody.length });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    const pngMagic = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = await fs.write('/tmp/img.png', pngMagic);

    const url = new URL(capturedUrl);
    expect(url.searchParams.get('path')).toBe('/tmp/img.png');
    expect(url.searchParams.get('username')).toBe('user');
    expect(capturedContentType.toLowerCase()).toContain('application/octet-stream');
    expect(capturedBody).not.toBeNull();
    expect(Array.from(capturedBody!)).toEqual(Array.from(pngMagic));
    expect(result).toEqual({ path: '/tmp/img.png', size: 8 });
    client.close();
  });

  it('write() with non-UTF-8 bytes does NOT produce U+FFFD (0xEF 0xBF 0xBD) on the wire', async () => {
    let capturedBody: Uint8Array | null = null;
    server.use(
      http.put(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/raw`, async ({ request }) => {
        capturedBody = new Uint8Array(await request.arrayBuffer());
        return HttpResponse.json({ path: '/tmp/x.bin', size: capturedBody.length });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    const payload = new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x80, 0x81, 0xc0, 0xc1]);
    await fs.write('/tmp/x.bin', payload);

    // Regression guard: the wire body must not contain any 0xEF 0xBF 0xBD
    // (UTF-8 encoding of U+FFFD), the fingerprint of the old decode-replace bug.
    const body = capturedBody!;
    let sawFFDB = false;
    for (let i = 0; i + 2 < body.length; i++) {
      if (body[i] === 0xef && body[i + 1] === 0xbf && body[i + 2] === 0xbd) {
        sawFFDB = true;
        break;
      }
    }
    expect(sawFFDB).toBe(false);
    expect(Array.from(body)).toEqual(Array.from(payload));
    client.close();
  });

  it('write() with Uint8Array of 4 KiB random bytes round-trips byte-identical', async () => {
    let capturedBody: Uint8Array | null = null;
    server.use(
      http.put(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/raw`, async ({ request }) => {
        capturedBody = new Uint8Array(await request.arrayBuffer());
        return HttpResponse.json({ path: '/tmp/b.bin', size: capturedBody.length });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    const payload = new Uint8Array(4096);
    for (let i = 0; i < payload.length; i++) {
      payload[i] = Math.floor(Math.random() * 256);
    }
    await fs.write('/tmp/b.bin', payload);

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.length).toBe(4096);
    expect(Array.from(capturedBody!)).toEqual(Array.from(payload));
    client.close();
  });

  it('write() with string stays on JSON POST /files (does NOT hit /files/raw)', async () => {
    let rawCalled = false;
    let jsonCalled = false;
    server.use(
      http.put(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/raw`, () => {
        rawCalled = true;
        return HttpResponse.json({ path: '/t.txt', size: 5 });
      }),
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files`, async ({ request }) => {
        jsonCalled = true;
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toEqual({ path: '/t.txt', data: 'hello', username: 'user' });
        return HttpResponse.json({ path: '/t.txt', size: 5 });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    await fs.write('/t.txt', 'hello');

    expect(jsonCalled).toBe(true);
    expect(rawCalled).toBe(false);
    client.close();
  });

  // ---- writeFiles ----

  it('writeFiles() with string-only entries uses JSON batch endpoint', async () => {
    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/batch`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json([
          { path: '/a.txt', size: 1 },
          { path: '/b.txt', size: 2 },
        ]);
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    const result = await fs.writeFiles([
      { path: '/a.txt', data: 'a' },
      { path: '/b.txt', data: 'bb' },
    ]);

    expect(capturedBody).toEqual({
      files: [
        { path: '/a.txt', data: 'a' },
        { path: '/b.txt', data: 'bb' },
      ],
      username: 'user',
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ path: '/a.txt', size: 1 });
    expect(result[1]).toEqual({ path: '/b.txt', size: 2 });
    client.close();
  });

  it('writeFiles() partitions mixed str + Uint8Array entries across both endpoints', async () => {
    let batchBody: Record<string, unknown> = {};
    let rawCalls: { path: string; body: Uint8Array }[] = [];
    server.use(
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/batch`, async ({ request }) => {
        batchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json([{ path: '/a.txt', size: 5 }]);
      }),
      http.put(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/raw`, async ({ request }) => {
        const url = new URL(request.url);
        const body = new Uint8Array(await request.arrayBuffer());
        rawCalls.push({ path: url.searchParams.get('path') ?? '', body });
        return HttpResponse.json({ path: url.searchParams.get('path'), size: body.length });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    const binaryPayload = new Uint8Array([0xff, 0x00, 0x89, 0x50]);
    const result = await fs.writeFiles([
      { path: '/a.txt', data: 'hello' },
      { path: '/b.bin', data: binaryPayload },
    ]);

    // String entry went through the JSON batch (and only that one)
    const batchFiles = batchBody.files as Array<Record<string, unknown>>;
    expect(batchFiles).toHaveLength(1);
    expect(batchFiles[0]).toEqual({ path: '/a.txt', data: 'hello' });

    // Bytes entry streamed to /files/raw byte-identically
    expect(rawCalls).toHaveLength(1);
    expect(rawCalls[0].path).toBe('/b.bin');
    expect(Array.from(rawCalls[0].body)).toEqual(Array.from(binaryPayload));

    // Merged results preserve input order
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('/a.txt');
    expect(result[1].path).toBe('/b.bin');
    expect(result[1].size).toBe(4);
    client.close();
  });

  it('writeFiles() with Uint8Array-only entries skips batch endpoint entirely', async () => {
    let batchCalled = false;
    const rawPaths: string[] = [];
    server.use(
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/batch`, () => {
        batchCalled = true;
        return HttpResponse.json([]);
      }),
      http.put(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/raw`, async ({ request }) => {
        const url = new URL(request.url);
        const path = url.searchParams.get('path') ?? '';
        rawPaths.push(path);
        const body = new Uint8Array(await request.arrayBuffer());
        return HttpResponse.json({ path, size: body.length });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    await fs.writeFiles([
      { path: '/a.bin', data: new Uint8Array([0xff]) },
      { path: '/b.bin', data: new Uint8Array([0xfe]) },
    ]);

    expect(batchCalled).toBe(false);
    expect(rawPaths).toEqual(['/a.bin', '/b.bin']);
    client.close();
  });

  // ---- list ----

  it('list() sends GET with default depth', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/list`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([
          { name: 'a.txt', path: '/tmp/a.txt', type: 'file', size: 10 },
        ]);
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    const result = await fs.list('/tmp');

    const url = new URL(capturedUrl);
    expect(url.searchParams.get('path')).toBe('/tmp');
    expect(url.searchParams.get('username')).toBe('user');
    expect(url.searchParams.has('depth')).toBe(false);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'a.txt', path: '/tmp/a.txt', type: FileType.File, size: 10 });
    client.close();
  });

  it('list() sends GET with custom depth', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/list`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([]);
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    await fs.list('/tmp', { depth: 3 });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get('depth')).toBe('3');
    client.close();
  });

  // ---- exists ----

  it('exists() returns true when file exists', async () => {
    server.use(
      http.get(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/exists`, () => {
        return HttpResponse.json({ exists: true });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    expect(await fs.exists('/tmp/yes.txt')).toBe(true);
    client.close();
  });

  it('exists() returns false when file does not exist', async () => {
    server.use(
      http.get(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/exists`, () => {
        return HttpResponse.json({ exists: false });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    expect(await fs.exists('/tmp/no.txt')).toBe(false);
    client.close();
  });

  // ---- getInfo ----

  it('getInfo() returns parsed EntryInfo', async () => {
    server.use(
      http.get(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/info`, () => {
        return HttpResponse.json({ name: 'test.txt', path: '/tmp/test.txt', type: 'file', size: 42 });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    const info = await fs.getInfo('/tmp/test.txt');
    expect(info).toEqual({ name: 'test.txt', path: '/tmp/test.txt', type: FileType.File, size: 42 });
    client.close();
  });

  // ---- remove ----

  it('remove() uses query params (NOT URL string concatenation)', async () => {
    let capturedUrl = '';
    server.use(
      http.delete(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files`, ({ request }) => {
        capturedUrl = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    await fs.remove('/tmp/evil?inject=true&admin=1');

    // Verify proper encoding: the path should be a single query param value,
    // NOT concatenated into the URL where ? and & would be interpreted
    const url = new URL(capturedUrl);
    expect(url.searchParams.get('path')).toBe('/tmp/evil?inject=true&admin=1');
    expect(url.searchParams.get('username')).toBe('user');
    // The 'inject' and 'admin' should NOT appear as separate params
    expect(url.searchParams.has('inject')).toBe(false);
    expect(url.searchParams.has('admin')).toBe(false);
    client.close();
  });

  // ---- rename ----

  it('rename() sends PATCH with old_path and new_path', async () => {
    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.patch(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ name: 'new.txt', path: '/tmp/new.txt', type: 'file', size: 10 });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    const result = await fs.rename('/tmp/old.txt', '/tmp/new.txt');

    expect(capturedBody).toEqual({ old_path: '/tmp/old.txt', new_path: '/tmp/new.txt', username: 'user' });
    expect(result).toEqual({ name: 'new.txt', path: '/tmp/new.txt', type: FileType.File, size: 10 });
    client.close();
  });

  // ---- makeDir ----

  it('makeDir() returns created boolean', async () => {
    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/mkdir`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ created: true });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    const created = await fs.makeDir('/tmp/newdir');

    expect(capturedBody).toEqual({ path: '/tmp/newdir', username: 'user' });
    expect(created).toBe(true);
    client.close();
  });

  // ---- watchDir ----

  it('watchDir() sends POST and returns WatchHandle', async () => {
    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/watch`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    const handle = await fs.watchDir('/tmp/watched', { recursive: true });

    expect(capturedBody).toEqual({ path: '/tmp/watched', username: 'user', recursive: true });
    expect(handle).toBeDefined();
    expect(handle.getNewEvents()).toEqual([]);
    handle.stop();
    client.close();
  });

  // ---- default user ----

  it('default user is "user" for all methods', async () => {
    const capturedUsers: string[] = [];

    server.use(
      http.get(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files`, ({ request }) => {
        const url = new URL(request.url);
        capturedUsers.push(url.searchParams.get('username') ?? '');
        return HttpResponse.text('data');
      }),
      http.post(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        capturedUsers.push(body.username as string);
        return HttpResponse.json({ path: '/x', size: 1 });
      }),
      http.delete(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files`, ({ request }) => {
        const url = new URL(request.url);
        capturedUsers.push(url.searchParams.get('username') ?? '');
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);

    await fs.read('/a');
    await fs.write('/b', 'x');
    await fs.remove('/c');

    expect(capturedUsers).toEqual(['user', 'user', 'user']);
    client.close();
  });

  // ---- custom user ----

  it('custom user is passed correctly', async () => {
    let capturedUsername = '';
    server.use(
      http.get(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files`, ({ request }) => {
        const url = new URL(request.url);
        capturedUsername = url.searchParams.get('username') ?? '';
        return HttpResponse.text('data');
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    await fs.read('/tmp/file', { user: 'admin' });

    expect(capturedUsername).toBe('admin');
    client.close();
  });

  // ---- requestTimeout ----

  it('requestTimeout is forwarded to client', async () => {
    server.use(
      http.get(`${BASE_URL}/sandboxes/${SANDBOX_ID}/files/exists`, () => {
        return HttpResponse.json({ exists: true });
      }),
    );

    const client = makeClient();
    const fs = new Filesystem(SANDBOX_ID, client);
    // Should not throw — just verifies the option is accepted and forwarded
    const result = await fs.exists('/tmp/x', { requestTimeout: 10000 });
    expect(result).toBe(true);
    client.close();
  });
});
