import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { Volumes } from '../../../src/volumes/volumes.js';
import { InvalidArgumentError, ConflictError } from '../../../src/errors.js';

const BASE_URL = 'http://localhost:9999';
const OPTS = { domain: 'localhost:9999', apiKey: 'test-key' };

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('VolumeLocks.acquire', () => {
  it('POSTs /locks with path + ttl_seconds and parses the lease', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedUrl = '';
    server.use(
      http.post(`${BASE_URL}/volumes/vol-1/locks`, async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          token: 'tok-1',
          ttl_seconds: 30,
          expires_at: '2026-01-01T00:00:30Z',
        });
      }),
    );
    const lease = await Volumes.locks('vol-1', OPTS).acquire('/a.txt', 30);
    expect(new URL(capturedUrl).pathname).toBe('/volumes/vol-1/locks');
    expect(capturedBody).toEqual({ path: '/a.txt', ttl_seconds: 30 });
    expect(lease).toEqual({
      token: 'tok-1',
      ttlSeconds: 30,
      expiresAt: '2026-01-01T00:00:30Z',
    });
  });

  it('omits ttl_seconds when not provided', async () => {
    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE_URL}/volumes/vol-1/locks`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ token: 't', ttl_seconds: 60, expires_at: 'x' });
      }),
    );
    await Volumes.locks('vol-1', OPTS).acquire('/a.txt');
    expect(capturedBody).toEqual({ path: '/a.txt' });
  });

  it('surfaces a 409 already-locked as ConflictError', async () => {
    server.use(
      http.post(`${BASE_URL}/volumes/vol-1/locks`, () =>
        HttpResponse.json({ message: 'already locked' }, { status: 409 }),
      ),
    );
    await expect(Volumes.locks('vol-1', OPTS).acquire('/a.txt')).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('VolumeLocks.release', () => {
  it('DELETEs /locks WITH a JSON body of path + token', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedUrl = '';
    server.use(
      http.delete(`${BASE_URL}/volumes/vol-1/locks`, async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ released: true });
      }),
    );
    const released = await Volumes.locks('vol-1', OPTS).release('/a.txt', 'tok-1');
    expect(new URL(capturedUrl).pathname).toBe('/volumes/vol-1/locks');
    expect(capturedBody).toEqual({ path: '/a.txt', token: 'tok-1' });
    expect(released).toBe(true);
  });

  it('surfaces a 409 not-the-holder as ConflictError', async () => {
    server.use(
      http.delete(`${BASE_URL}/volumes/vol-1/locks`, () =>
        HttpResponse.json({ message: 'not holder' }, { status: 409 }),
      ),
    );
    await expect(
      Volumes.locks('vol-1', OPTS).release('/a.txt', 'wrong'),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('VolumeLocks.renew', () => {
  it('POSTs /locks/renew with path + token + ttl_seconds', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedUrl = '';
    server.use(
      http.post(`${BASE_URL}/volumes/vol-1/locks/renew`, async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = (await request.json()) as Record<string, unknown>;
        // Real server shape: renew returns no token (the caller holds it).
        return HttpResponse.json({
          renewed: true,
          ttl_seconds: 45,
          expires_at: '2026-01-01T00:00:45Z',
        });
      }),
    );
    const lease = await Volumes.locks('vol-1', OPTS).renew('/a.txt', 'tok-1', 45);
    expect(new URL(capturedUrl).pathname).toBe('/volumes/vol-1/locks/renew');
    expect(capturedBody).toEqual({ path: '/a.txt', token: 'tok-1', ttl_seconds: 45 });
    expect(lease.ttlSeconds).toBe(45);
    // The token is echoed from the caller's input, not the (token-less) response.
    expect(lease.token).toBe('tok-1');
  });

  it('surfaces a 409 not-the-holder as ConflictError', async () => {
    server.use(
      http.post(`${BASE_URL}/volumes/vol-1/locks/renew`, () =>
        HttpResponse.json({ message: 'not holder' }, { status: 409 }),
      ),
    );
    await expect(
      Volumes.locks('vol-1', OPTS).renew('/a.txt', 'wrong'),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('VolumeLocks.status', () => {
  it('GETs /locks with path query and parses status', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE_URL}/volumes/vol-1/locks`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ held: true, expires_in_ms: 12000 });
      }),
    );
    const st = await Volumes.locks('vol-1', OPTS).status('/a.txt');
    const u = new URL(capturedUrl);
    expect(u.pathname).toBe('/volumes/vol-1/locks');
    expect(u.searchParams.get('path')).toBe('/a.txt');
    expect(st).toEqual({ held: true, expiresInMs: 12000 });
  });
});

describe('VolumeLocks validation', () => {
  it('throws InvalidArgumentError on a malformed volume ID', () => {
    expect(() => Volumes.locks('bad/id', OPTS)).toThrow(InvalidArgumentError);
  });

  it('throws InvalidArgumentError when release is missing a token', async () => {
    await expect(Volumes.locks('vol-1', OPTS).release('/a.txt', '')).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });
});
