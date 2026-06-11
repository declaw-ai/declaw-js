import { ApiClient } from './api/client.js';
import { SandboxError } from './errors.js';
import type { SandboxInfo, SnapshotInfo } from './sandbox/models.js';
import { parseSandboxInfo, parseSnapshotInfo } from './sandbox/models.js';

/**
 * Paginator for listing sandboxes.
 *
 * Supports manual pagination via `nextItems()` and automatic iteration
 * via `for await (const page of paginator)`.
 */
export class SandboxPaginator {
  private readonly client: ApiClient;
  private readonly query: Record<string, string>;
  private readonly limit?: number;
  private _nextToken: string | undefined;
  private _exhausted = false;

  constructor(
    client: ApiClient,
    opts?: { query?: Record<string, string>; limit?: number },
  ) {
    this.client = client;
    this.query = opts?.query ?? {};
    this.limit = opts?.limit;
  }

  /** Whether there are more pages to fetch. */
  get hasNext(): boolean {
    return !this._exhausted;
  }

  /**
   * Fetch the next page of sandboxes.
   *
   * @throws SandboxError when no more pages are available.
   */
  async nextItems(): Promise<SandboxInfo[]> {
    if (this._exhausted) {
      throw new SandboxError('No more pages');
    }

    const params: Record<string, string> = { ...this.query };
    if (this.limit !== undefined) {
      params.limit = String(this.limit);
    }
    if (this._nextToken) {
      params.next_token = this._nextToken;
    }

    const data = await this.client.get('/sandboxes', { params });
    const response = data as Record<string, unknown>;
    const rawSandboxes = (response.sandboxes ?? []) as Record<string, unknown>[];
    const nextToken = response.next_token as string | null;

    if (nextToken) {
      this._nextToken = nextToken;
    } else {
      this._exhausted = true;
      this._nextToken = undefined;
    }

    return rawSandboxes.map((raw) => parseSandboxInfo(raw));
  }

  /** Async iterator that yields pages until exhausted. */
  async *[Symbol.asyncIterator](): AsyncIterator<SandboxInfo[]> {
    while (this.hasNext) {
      yield await this.nextItems();
    }
  }
}

/**
 * Paginator for listing snapshots.
 *
 * Supports manual pagination via `nextItems()` and automatic iteration
 * via `for await (const page of paginator)`.
 */
export class SnapshotPaginator {
  private readonly client: ApiClient;
  private readonly sandboxId?: string;
  private readonly limit?: number;
  private _nextToken: string | undefined;
  private _exhausted = false;

  constructor(
    client: ApiClient,
    opts?: { sandboxId?: string; limit?: number },
  ) {
    this.client = client;
    this.sandboxId = opts?.sandboxId;
    this.limit = opts?.limit;
  }

  /** Whether there are more pages to fetch. */
  get hasNext(): boolean {
    return !this._exhausted;
  }

  /**
   * Fetch the next page of snapshots.
   *
   * @throws SandboxError when no more pages are available.
   */
  async nextItems(): Promise<SnapshotInfo[]> {
    if (this._exhausted) {
      throw new SandboxError('No more pages');
    }

    const params: Record<string, string> = {};
    if (this.sandboxId) {
      params.sandbox_id = this.sandboxId;
    }
    if (this.limit !== undefined) {
      params.limit = String(this.limit);
    }
    if (this._nextToken) {
      params.next_token = this._nextToken;
    }

    const data = await this.client.get('/snapshots', { params });
    const response = data as Record<string, unknown>;
    const rawSnapshots = (response.snapshots ?? []) as Record<string, unknown>[];
    const nextToken = response.next_token as string | null;

    if (nextToken) {
      this._nextToken = nextToken;
    } else {
      this._exhausted = true;
      this._nextToken = undefined;
    }

    return rawSnapshots.map((raw) => parseSnapshotInfo(raw));
  }

  /** Async iterator that yields pages until exhausted. */
  async *[Symbol.asyncIterator](): AsyncIterator<SnapshotInfo[]> {
    while (this.hasNext) {
      yield await this.nextItems();
    }
  }
}
