import { ConnectionConfig } from '../connectionConfig.js';
import { getSharedClient } from '../api/client.js';
import { InvalidArgumentError } from '../errors.js';
import type { FileEntry, FileInfo } from './models.js';
import { parseFileEntry, parseFileInfo } from './models.js';
import type { VolumeRequestOpts } from './types.js';

const VALID_VOLUME_ID_RE = /^[a-zA-Z0-9_-]+$/;

function assertValidVolumeId(id: string): void {
  if (!id || !VALID_VOLUME_ID_RE.test(id)) {
    throw new InvalidArgumentError(
      `Invalid volume ID: "${id}". Must be alphanumeric with hyphens/underscores only.`,
    );
  }
}

/** Options for VolumeFiles.write. */
export interface VolumeWriteOpts extends VolumeRequestOpts {
  /**
   * CAS token from `info(path).version`. When set, the server rejects the
   * write with a ConflictError (409) if the file changed since the token was
   * read. Omit for an unconditional write.
   */
  ifVersion?: string;
}

/** Options for VolumeFiles.remove. */
export interface VolumeRemoveOpts extends VolumeRequestOpts {
  /** Recursively remove a directory and its contents. */
  recursive?: boolean;
}

/**
 * File-granular operations on a single volume.
 *
 * Only valid for file-granular (non-tarball) volumes — the server returns
 * a ConflictError (409) for a tarball-backed volume and a 503 when no
 * file-granular accessor is configured. Obtain an instance via
 * `Volumes.files(volumeId)`.
 */
export class VolumeFiles {
  private readonly volumeId: string;
  private readonly opts?: VolumeRequestOpts;

  constructor(volumeId: string, opts?: VolumeRequestOpts) {
    assertValidVolumeId(volumeId);
    this.volumeId = volumeId;
    this.opts = opts;
  }

  private client() {
    const config = new ConnectionConfig({
      apiKey: this.opts?.apiKey,
      domain: this.opts?.domain,
      apiUrl: this.opts?.apiUrl,
      requestTimeout: this.opts?.requestTimeout,
    });
    return getSharedClient(config);
  }

  private timeout(): number | undefined {
    return this.opts?.requestTimeout;
  }

  /** Write raw bytes to `path`. Optionally conditional on `ifVersion` (CAS). */
  async write(
    path: string,
    data: Uint8Array | ArrayBuffer,
    opts?: VolumeWriteOpts,
  ): Promise<string> {
    if (!path) {
      throw new InvalidArgumentError('path is required');
    }
    const params: Record<string, string> = { path };
    if (opts?.ifVersion) {
      params.if_version = opts.ifVersion;
    }
    const body = data instanceof Uint8Array ? data : new Uint8Array(data);
    const resp = (await this.client().put(`/volumes/${this.volumeId}/files/raw`, {
      params,
      body,
      headers: { 'Content-Type': 'application/octet-stream' },
      timeout: opts?.requestTimeout ?? this.timeout(),
    })) as Record<string, unknown>;
    return String(resp.path ?? path);
  }

  /** Read raw bytes from `path`. */
  async read(path: string): Promise<Uint8Array> {
    if (!path) {
      throw new InvalidArgumentError('path is required');
    }
    return this.client().getBytes(`/volumes/${this.volumeId}/files/raw`, {
      params: { path },
      timeout: this.timeout(),
    });
  }

  /** List directory entries under `path`. */
  async list(path: string): Promise<FileEntry[]> {
    if (!path) {
      throw new InvalidArgumentError('path is required');
    }
    const resp = (await this.client().get(`/volumes/${this.volumeId}/files/list`, {
      params: { path },
      timeout: this.timeout(),
    })) as Record<string, unknown>;
    const rows = (resp.entries as Record<string, unknown>[] | undefined) ?? [];
    return rows.map(parseFileEntry);
  }

  /** Stat `path`, returning the entry plus the CAS `version` token. */
  async info(path: string): Promise<FileInfo> {
    if (!path) {
      throw new InvalidArgumentError('path is required');
    }
    const resp = (await this.client().get(`/volumes/${this.volumeId}/files/info`, {
      params: { path },
      timeout: this.timeout(),
    })) as Record<string, unknown>;
    return parseFileInfo(resp);
  }

  /** Return whether `path` exists. */
  async exists(path: string): Promise<boolean> {
    if (!path) {
      throw new InvalidArgumentError('path is required');
    }
    const resp = (await this.client().get(`/volumes/${this.volumeId}/files/exists`, {
      params: { path },
      timeout: this.timeout(),
    })) as Record<string, unknown>;
    return Boolean(resp.exists ?? false);
  }

  /** Remove `path`. Pass `{ recursive: true }` to remove a directory tree. */
  async remove(path: string, opts?: VolumeRemoveOpts): Promise<void> {
    if (!path) {
      throw new InvalidArgumentError('path is required');
    }
    const params: Record<string, string> = {
      path,
      recursive: opts?.recursive ? 'true' : 'false',
    };
    await this.client().delete(`/volumes/${this.volumeId}/files`, {
      params,
      timeout: opts?.requestTimeout ?? this.timeout(),
    });
  }

  /** Rename `oldPath` to `newPath`. */
  async rename(oldPath: string, newPath: string): Promise<{ oldPath: string; newPath: string }> {
    if (!oldPath || !newPath) {
      throw new InvalidArgumentError('oldPath and newPath are required');
    }
    const resp = (await this.client().patch(`/volumes/${this.volumeId}/files`, {
      json: { old_path: oldPath, new_path: newPath },
      timeout: this.timeout(),
    })) as Record<string, unknown>;
    return {
      oldPath: String(resp.old_path ?? oldPath),
      newPath: String(resp.new_path ?? newPath),
    };
  }

  /** Create a directory at `path`. */
  async mkdir(path: string): Promise<string> {
    if (!path) {
      throw new InvalidArgumentError('path is required');
    }
    const resp = (await this.client().post(`/volumes/${this.volumeId}/files/mkdir`, {
      json: { path },
      timeout: this.timeout(),
    })) as Record<string, unknown>;
    return String(resp.path ?? path);
  }
}
