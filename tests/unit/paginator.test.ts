import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { SandboxPaginator, SnapshotPaginator } from '../../src/paginator.js';
import { ApiClient } from '../../src/api/client.js';
import { ConnectionConfig } from '../../src/connectionConfig.js';
import { SandboxError } from '../../src/errors.js';

const BASE_URL = 'http://localhost:9999';

function makeClient(): ApiClient {
  return new ApiClient(
    new ConnectionConfig({ apiKey: 'test-key', domain: 'localhost:9999' }),
    { maxRetries: 1, retryDelay: 0 },
  );
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('SandboxPaginator', () => {
  it('nextItems() returns first page of sandboxes', async () => {
    server.use(
      http.get(`${BASE_URL}/sandboxes`, () =>
        HttpResponse.json({
          sandboxes: [
            { sandbox_id: 'sbx-1', template_id: 't1', name: 'test', metadata: {}, state: 'running' },
          ],
          next_token: null,
        }),
      ),
    );

    const paginator = new SandboxPaginator(makeClient());
    const items = await paginator.nextItems();

    expect(items).toHaveLength(1);
    expect(items[0].sandboxId).toBe('sbx-1');
  });

  it('paginates with nextToken across multiple pages', async () => {
    let callCount = 0;
    server.use(
      http.get(`${BASE_URL}/sandboxes`, ({ request }) => {
        callCount++;
        const url = new URL(request.url);
        const token = url.searchParams.get('next_token');

        if (!token) {
          return HttpResponse.json({
            sandboxes: [{ sandbox_id: 'sbx-1', template_id: 't1', name: '', metadata: {}, state: 'running' }],
            next_token: 'page2',
          });
        }
        return HttpResponse.json({
          sandboxes: [{ sandbox_id: 'sbx-2', template_id: 't1', name: '', metadata: {}, state: 'running' }],
          next_token: null,
        });
      }),
    );

    const paginator = new SandboxPaginator(makeClient());
    const page1 = await paginator.nextItems();
    expect(page1[0].sandboxId).toBe('sbx-1');
    expect(paginator.hasNext).toBe(true);

    const page2 = await paginator.nextItems();
    expect(page2[0].sandboxId).toBe('sbx-2');
    expect(paginator.hasNext).toBe(false);
    expect(callCount).toBe(2);
  });

  it('hasNext is false when exhausted', async () => {
    server.use(
      http.get(`${BASE_URL}/sandboxes`, () =>
        HttpResponse.json({ sandboxes: [], next_token: null }),
      ),
    );

    const paginator = new SandboxPaginator(makeClient());
    await paginator.nextItems();

    expect(paginator.hasNext).toBe(false);
  });

  it('throws SandboxError when calling nextItems after exhaustion', async () => {
    server.use(
      http.get(`${BASE_URL}/sandboxes`, () =>
        HttpResponse.json({ sandboxes: [], next_token: null }),
      ),
    );

    const paginator = new SandboxPaginator(makeClient());
    await paginator.nextItems();

    await expect(paginator.nextItems()).rejects.toThrow(SandboxError);
    await expect(paginator.nextItems()).rejects.toThrow('No more pages');
  });

  it('async iterator yields all pages then stops', async () => {
    let callCount = 0;
    server.use(
      http.get(`${BASE_URL}/sandboxes`, () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({
            sandboxes: [{ sandbox_id: 'sbx-a', template_id: 't1', name: '', metadata: {}, state: 'running' }],
            next_token: 'tok2',
          });
        }
        return HttpResponse.json({
          sandboxes: [{ sandbox_id: 'sbx-b', template_id: 't1', name: '', metadata: {}, state: 'running' }],
          next_token: null,
        });
      }),
    );

    const paginator = new SandboxPaginator(makeClient());
    const allPages: string[] = [];

    for await (const page of paginator) {
      for (const item of page) {
        allPages.push(item.sandboxId);
      }
    }

    expect(allPages).toEqual(['sbx-a', 'sbx-b']);
  });
});

describe('SnapshotPaginator', () => {
  it('nextItems() returns first page of snapshots', async () => {
    server.use(
      http.get(`${BASE_URL}/snapshots`, () =>
        HttpResponse.json({
          snapshots: [
            { snapshot_id: 'snap-1', sandbox_id: 'sbx-1' },
          ],
          next_token: null,
        }),
      ),
    );

    const paginator = new SnapshotPaginator(makeClient());
    const items = await paginator.nextItems();

    expect(items).toHaveLength(1);
    expect(items[0].snapshotId).toBe('snap-1');
  });

  it('paginates with nextToken across multiple pages', async () => {
    let callCount = 0;
    server.use(
      http.get(`${BASE_URL}/snapshots`, () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({
            snapshots: [{ snapshot_id: 'snap-1', sandbox_id: 'sbx-1' }],
            next_token: 'page2',
          });
        }
        return HttpResponse.json({
          snapshots: [{ snapshot_id: 'snap-2', sandbox_id: 'sbx-1' }],
          next_token: null,
        });
      }),
    );

    const paginator = new SnapshotPaginator(makeClient());
    const page1 = await paginator.nextItems();
    expect(page1[0].snapshotId).toBe('snap-1');
    expect(paginator.hasNext).toBe(true);

    const page2 = await paginator.nextItems();
    expect(page2[0].snapshotId).toBe('snap-2');
    expect(paginator.hasNext).toBe(false);
  });

  it('throws SandboxError when exhausted', async () => {
    server.use(
      http.get(`${BASE_URL}/snapshots`, () =>
        HttpResponse.json({ snapshots: [], next_token: null }),
      ),
    );

    const paginator = new SnapshotPaginator(makeClient());
    await paginator.nextItems();

    await expect(paginator.nextItems()).rejects.toThrow(SandboxError);
    await expect(paginator.nextItems()).rejects.toThrow('No more pages');
  });

  it('passes sandboxId as query parameter', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE_URL}/snapshots`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ snapshots: [], next_token: null });
      }),
    );

    const paginator = new SnapshotPaginator(makeClient(), { sandboxId: 'sbx-filter' });
    await paginator.nextItems();

    const url = new URL(capturedUrl);
    expect(url.searchParams.get('sandbox_id')).toBe('sbx-filter');
  });
});
