import { describe, expect, it, vi, afterEach } from 'vitest';

import { ApiClient } from '../../../src/api/client.js';
import {
  CODE_IDEMPOTENCY_IN_PROGRESS,
  CODE_IDEMPOTENCY_KEY_REUSED,
  CODE_TEMPLATE_NOT_READY,
  newIdempotencyKey,
  retryAfterMs,
} from '../../../src/api/idempotency.js';
import { ConnectionConfig } from '../../../src/connectionConfig.js';

const UUID4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function client() {
  // retryDelay 0 disables backoff entirely, so these run at full speed.
  return new ApiClient(
    new ConnectionConfig({ apiKey: 'k', apiUrl: 'https://x.invalid' }),
    { retryDelay: 0 },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('newIdempotencyKey', () => {
  it('is a v4 UUID', () => {
    expect(newIdempotencyKey()).toMatch(UUID4);
  });

  // A collision between two tenants' concurrent creates would hand one caller
  // the other's sandbox. Correctness boundary, not cosmetics.
  it('does not repeat', () => {
    const keys = new Set(Array.from({ length: 10_000 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(10_000);
  });
});

describe('retryAfterMs', () => {
  it.each([
    [null, undefined],
    ['2', 2000],
    ['0', 0],
    ['-5', undefined],
    ['garbage', undefined],
    ['Wed, 21 Oct 2026 07:28:00 GMT', undefined], // HTTP-date form unsupported
    ['9999', 60_000], // clamped; a server must not pin a client for hours
  ])('Retry-After %s -> %s', (hdr, want) => {
    const headers = hdr === null ? {} : { 'Retry-After': hdr as string };
    expect(retryAfterMs(new Response('', { headers }))).toBe(want);
  });
});

describe('ApiClient idempotency handling', () => {
  // THE CASE THE WHOLE CHANGE RESTS ON. The key must survive retries; a fresh
  // key per attempt makes every retry a new create — the bug this fixes.
  it('reuses one key across retries', async () => {
    const seen: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts: any) => {
        seen.push(new Headers(opts.headers).get('Idempotency-Key'));
        return seen.length < 3
          ? jsonResponse(500, { message: 'boom' })
          : jsonResponse(200, { sandbox_id: 'sbx-1' });
      }),
    );

    const key = newIdempotencyKey();
    await client().post('/sandboxes', { json: {}, headers: { 'Idempotency-Key': key } });

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe(key);
  });

  it('retries a 409 idempotency_in_progress', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return calls === 1
          ? jsonResponse(409, { code: CODE_IDEMPOTENCY_IN_PROGRESS }, { 'Retry-After': '0' })
          : jsonResponse(200, { sandbox_id: 'sbx-1' });
      }),
    );

    await client().post('/sandboxes', { json: {}, headers: { 'Idempotency-Key': 'k1' } });
    expect(calls).toBe(2);
  });

  // 409 means two unrelated things here. Retrying template_not_ready burns the
  // caller's budget waiting for something that will not change.
  it('does not retry a 409 template_not_ready, and surfaces its code', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return jsonResponse(409, { code: CODE_TEMPLATE_NOT_READY, message: 'building' });
      }),
    );

    await expect(
      client().post('/sandboxes', { json: {}, headers: { 'Idempotency-Key': 'k1' } }),
    ).rejects.toMatchObject({ code: CODE_TEMPLATE_NOT_READY });
    expect(calls).toBe(1);
  });

  // The 409 path reads the body to inspect the code. Response bodies are
  // single-read, so a naive implementation loses the message when it rebuilds
  // the error — this pins that the message survives.
  it('keeps the error message after peeking at the code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(409, { code: CODE_TEMPLATE_NOT_READY, message: 'template is building' }),
      ),
    );

    await expect(
      client().post('/sandboxes', { json: {}, headers: { 'Idempotency-Key': 'k1' } }),
    ).rejects.toThrow(/template is building/);
  });

  it('surfaces the code on a 422 key reuse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(422, { code: CODE_IDEMPOTENCY_KEY_REUSED, message: 'reused' }),
      ),
    );

    await expect(
      client().post('/sandboxes', { json: {}, headers: { 'Idempotency-Key': 'k1' } }),
    ).rejects.toMatchObject({ code: CODE_IDEMPOTENCY_KEY_REUSED });
  });

  it('leaves errors without a code undefined rather than empty-string', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { message: 'nope' })));
    await expect(client().get('/sandboxes/x')).rejects.toMatchObject({ code: undefined });
  });
});

describe('Sandbox.create wiring', () => {
  // Everything above drives ApiClient.post with a header supplied by the test,
  // which proves the retry loop preserves a key but says nothing about whether
  // create generates one. Dropping the header at the call site would leave every
  // other test in this file green while restoring the original bug.
  it('sends an Idempotency-Key, fresh per logical create', async () => {
    const keys: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts: any) => {
        keys.push(new Headers(opts.headers).get('Idempotency-Key'));
        return jsonResponse(200, { sandbox_id: 'sbx-1', status: 'running' });
      }),
    );

    const { Sandbox } = await import('../../../src/sandbox/sandbox.js');
    const opts = { apiKey: 'k', apiUrl: 'https://x.invalid' };
    await Sandbox.create(opts as any);
    await Sandbox.create(opts as any);

    expect(keys).toHaveLength(2);
    for (const k of keys) {
      expect(k, 'create sent no Idempotency-Key — the duplicate-sandbox bug is back').toBeTruthy();
      expect(k).toMatch(UUID4);
    }
    // Per LOGICAL create: sharing one key across two creates would make the
    // second replay the first's response and return the wrong sandbox.
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe('public surface', () => {
  // The docs tell users to import these from '@declaw/sdk'. They existed only
  // in an internal module, so the feature was unusable as documented — callers
  // cannot branch on codes they cannot import.
  it('exports the codes from the package index', async () => {
    const pkg = await import('../../../src/index.js');
    expect(pkg.CODE_IDEMPOTENCY_IN_PROGRESS).toBe('idempotency_in_progress');
    expect(pkg.CODE_IDEMPOTENCY_KEY_REUSED).toBe('idempotency_key_reused');
    expect(pkg.CODE_TEMPLATE_NOT_READY).toBe('template_not_ready');
  });
});
