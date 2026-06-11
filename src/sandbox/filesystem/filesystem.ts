import type { ApiClient } from '../../api/client.js';
import type { EntryInfo, WriteInfo, WriteEntry } from './models.js';
import { parseEntryInfo, parseWriteInfo } from './models.js';
import { WatchHandle } from './watchHandle.js';

/** Default username for filesystem operations. */
const DEFAULT_USER = 'user';

/**
 * Filesystem operations for a sandbox.
 *
 * Provides methods to read, write, list, and manage files
 * within a sandbox's filesystem.
 */
export class Filesystem {
  private readonly sandboxId: string;
  private readonly client: ApiClient;

  constructor(sandboxId: string, client: ApiClient) {
    this.sandboxId = sandboxId;
    this.client = client;
  }

  /**
   * Read a file's contents.
   *
   * Default returns the content as a string. Pass `{ format: "bytes" }`
   * to get a `Uint8Array` for binary-safe reads — the SDK negotiates
   * `application/octet-stream` end-to-end so high-bit bytes survive the
   * round trip.
   *
   * @param path - Absolute path to the file.
   * @param opts - Optional format, user, and request timeout.
   * @returns The file contents as a string, or Uint8Array when format="bytes".
   */
  async read(
    path: string,
    opts?: { format?: 'text'; user?: string; requestTimeout?: number },
  ): Promise<string>;
  async read(
    path: string,
    opts: { format: 'bytes'; user?: string; requestTimeout?: number },
  ): Promise<Uint8Array>;
  async read(
    path: string,
    opts?: { format?: 'text' | 'bytes'; user?: string; requestTimeout?: number },
  ): Promise<string | Uint8Array> {
    const user = opts?.user ?? DEFAULT_USER;
    if (opts?.format === 'bytes') {
      return this.client.getBytes(
        `/sandboxes/${this.sandboxId}/files`,
        {
          params: { path, username: user },
          headers: { 'Accept': 'application/octet-stream' },
          timeout: opts?.requestTimeout,
        },
      );
    }
    const result = await this.client.get(
      `/sandboxes/${this.sandboxId}/files`,
      {
        params: { path, username: user },
        headers: { 'Accept': 'text/plain' },
        timeout: opts?.requestTimeout,
      },
    );
    // The API returns raw file content. We request text/plain, but the
    // generic response parser may still JSON-parse valid JSON content.
    // Always coerce to string for file reads.
    if (typeof result === 'string') {
      return result;
    }
    return JSON.stringify(result);
  }

  /**
   * Write data to a file.
   *
   * When `data` is a `Uint8Array`, the SDK streams the raw bytes to the
   * binary-safe `PUT /files/raw` endpoint (500 MiB cap). When it's a string,
   * the SDK uses the JSON `POST /files` endpoint. Callers do not need to
   * pick the transport.
   *
   * @param path - Absolute path to the file.
   * @param data - String or Uint8Array content to write.
   * @param opts - Optional user and request timeout.
   * @returns Information about the written file.
   */
  async write(
    path: string,
    data: string | Uint8Array,
    opts?: { user?: string; requestTimeout?: number },
  ): Promise<WriteInfo> {
    const user = opts?.user ?? DEFAULT_USER;
    if (data instanceof Uint8Array) {
      const result = await this.client.put(
        `/sandboxes/${this.sandboxId}/files/raw`,
        {
          params: { path, username: user },
          body: data,
          headers: { 'Content-Type': 'application/octet-stream' },
          timeout: opts?.requestTimeout,
        },
      );
      return parseWriteInfo(result as Record<string, unknown>);
    }
    const result = await this.client.post(
      `/sandboxes/${this.sandboxId}/files`,
      {
        json: { path, data, username: user },
        timeout: opts?.requestTimeout,
      },
    );
    return parseWriteInfo(result as Record<string, unknown>);
  }

  /**
   * Write multiple files in a single batch request.
   *
   * The batch endpoint is JSON-only and cannot carry binary. Entries are
   * partitioned: string entries go through `POST /files/batch` in one call,
   * `Uint8Array` entries are streamed individually to `PUT /files/raw`.
   * Results are merged back in input order.
   *
   * @param files - Array of files to write.
   * @param opts - Optional user and request timeout.
   * @returns Array of write info for each file, in input order.
   */
  async writeFiles(
    files: WriteEntry[],
    opts?: { user?: string; requestTimeout?: number },
  ): Promise<WriteInfo[]> {
    const user = opts?.user ?? DEFAULT_USER;
    const results: (WriteInfo | undefined)[] = new Array(files.length);

    const strIndices: number[] = [];
    const bytesIndices: number[] = [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].data instanceof Uint8Array) {
        bytesIndices.push(i);
      } else {
        strIndices.push(i);
      }
    }

    if (strIndices.length > 0) {
      const batchFiles = strIndices.map((i) => ({
        path: files[i].path,
        data: files[i].data as string,
      }));
      const result = await this.client.post(
        `/sandboxes/${this.sandboxId}/files/batch`,
        {
          json: { files: batchFiles, username: user },
          timeout: opts?.requestTimeout,
        },
      );
      const parsed = ((result ?? []) as Record<string, unknown>[]).map(parseWriteInfo);
      for (let k = 0; k < strIndices.length; k++) {
        results[strIndices[k]] = parsed[k];
      }
    }

    for (const i of bytesIndices) {
      const entry = files[i];
      const result = await this.client.put(
        `/sandboxes/${this.sandboxId}/files/raw`,
        {
          params: { path: entry.path, username: user },
          body: entry.data as Uint8Array,
          headers: { 'Content-Type': 'application/octet-stream' },
          timeout: opts?.requestTimeout,
        },
      );
      results[i] = parseWriteInfo(result as Record<string, unknown>);
    }

    return results.filter((r): r is WriteInfo => r !== undefined);
  }

  /**
   * List entries in a directory.
   *
   * @param path - Absolute path to the directory.
   * @param opts - Optional depth, user, and request timeout.
   * @returns Array of entry info objects.
   */
  async list(
    path: string,
    opts?: { depth?: number; user?: string; requestTimeout?: number },
  ): Promise<EntryInfo[]> {
    const user = opts?.user ?? DEFAULT_USER;
    const params: Record<string, string> = { path, username: user };
    if (opts?.depth !== undefined) {
      params.depth = String(opts.depth);
    }
    const result = await this.client.get(
      `/sandboxes/${this.sandboxId}/files/list`,
      {
        params,
        timeout: opts?.requestTimeout,
      },
    );
    return ((result ?? []) as Record<string, unknown>[]).map(parseEntryInfo);
  }

  /**
   * Check whether a file or directory exists.
   *
   * @param path - Absolute path to check.
   * @param opts - Optional user and request timeout.
   * @returns True if the path exists.
   */
  async exists(
    path: string,
    opts?: { user?: string; requestTimeout?: number },
  ): Promise<boolean> {
    const user = opts?.user ?? DEFAULT_USER;
    const result = await this.client.get(
      `/sandboxes/${this.sandboxId}/files/exists`,
      {
        params: { path, username: user },
        timeout: opts?.requestTimeout,
      },
    );
    return (result as Record<string, unknown>).exists as boolean;
  }

  /**
   * Get information about a file or directory.
   *
   * @param path - Absolute path to query.
   * @param opts - Optional user and request timeout.
   * @returns Entry information.
   */
  async getInfo(
    path: string,
    opts?: { user?: string; requestTimeout?: number },
  ): Promise<EntryInfo> {
    const user = opts?.user ?? DEFAULT_USER;
    const result = await this.client.get(
      `/sandboxes/${this.sandboxId}/files/info`,
      {
        params: { path, username: user },
        timeout: opts?.requestTimeout,
      },
    );
    return parseEntryInfo(result as Record<string, unknown>);
  }

  /**
   * Remove a file or directory.
   *
   * IMPORTANT: Uses proper query params to prevent URL injection.
   * This fixes the Python SDK vulnerability where path was concatenated
   * directly into the URL string.
   *
   * @param path - Absolute path to remove.
   * @param opts - Optional user and request timeout.
   */
  async remove(
    path: string,
    opts?: { user?: string; requestTimeout?: number },
  ): Promise<void> {
    const user = opts?.user ?? DEFAULT_USER;
    await this.client.delete(
      `/sandboxes/${this.sandboxId}/files`,
      {
        params: { path, username: user },
        timeout: opts?.requestTimeout,
      },
    );
  }

  /**
   * Rename (move) a file or directory.
   *
   * @param oldPath - Current path.
   * @param newPath - New path.
   * @param opts - Optional user and request timeout.
   * @returns Entry information for the renamed item.
   */
  async rename(
    oldPath: string,
    newPath: string,
    opts?: { user?: string; requestTimeout?: number },
  ): Promise<EntryInfo> {
    const user = opts?.user ?? DEFAULT_USER;
    const result = await this.client.patch(
      `/sandboxes/${this.sandboxId}/files`,
      {
        json: { old_path: oldPath, new_path: newPath, username: user },
        timeout: opts?.requestTimeout,
      },
    );
    return parseEntryInfo(result as Record<string, unknown>);
  }

  /**
   * Create a directory.
   *
   * @param path - Absolute path of the directory to create.
   * @param opts - Optional user and request timeout.
   * @returns True if the directory was created.
   */
  async makeDir(
    path: string,
    opts?: { user?: string; requestTimeout?: number },
  ): Promise<boolean> {
    const user = opts?.user ?? DEFAULT_USER;
    const result = await this.client.post(
      `/sandboxes/${this.sandboxId}/files/mkdir`,
      {
        json: { path, username: user },
        timeout: opts?.requestTimeout,
      },
    );
    return (result as Record<string, unknown>).created as boolean;
  }

  /**
   * Watch a directory for filesystem events.
   *
   * @param path - Absolute path of the directory to watch.
   * @param opts - Optional user, recursive flag, and request timeout.
   * @returns A WatchHandle to receive events and stop watching.
   */
  async watchDir(
    path: string,
    opts?: { user?: string; recursive?: boolean; requestTimeout?: number },
  ): Promise<WatchHandle> {
    const user = opts?.user ?? DEFAULT_USER;
    const recursive = opts?.recursive ?? false;
    await this.client.post(
      `/sandboxes/${this.sandboxId}/files/watch`,
      {
        json: { path, username: user, recursive },
        timeout: opts?.requestTimeout,
      },
    );
    return new WatchHandle();
  }
}
