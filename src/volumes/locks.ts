import { ConnectionConfig } from '../connectionConfig.js';
import { getSharedClient } from '../api/client.js';
import { InvalidArgumentError } from '../errors.js';
import type { LockLease, LockStatus } from './models.js';
import { parseLockLease, parseLockStatus } from './models.js';
import type { VolumeRequestOpts } from './types.js';

const VALID_VOLUME_ID_RE = /^[a-zA-Z0-9_-]+$/;

function assertValidVolumeId(id: string): void {
  if (!id || !VALID_VOLUME_ID_RE.test(id)) {
    throw new InvalidArgumentError(
      `Invalid volume ID: "${id}". Must be alphanumeric with hyphens/underscores only.`,
    );
  }
}

/**
 * Advisory locks (leases) over a (volume, path) pair.
 *
 * Acquire returns a token; renew/release require it. A ConflictError (409)
 * is raised on acquire when the path is already locked, and on renew/release
 * when the caller is not the current holder. Obtain an instance via
 * `Volumes.locks(volumeId)`.
 */
export class VolumeLocks {
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

  /** Acquire a lock on `path`. Throws ConflictError (409) if already held. */
  async acquire(path: string, ttlSeconds?: number): Promise<LockLease> {
    if (!path) {
      throw new InvalidArgumentError('path is required');
    }
    const json: Record<string, unknown> = { path };
    if (ttlSeconds !== undefined) {
      json.ttl_seconds = ttlSeconds;
    }
    const resp = (await this.client().post(`/volumes/${this.volumeId}/locks`, {
      json,
      timeout: this.timeout(),
    })) as Record<string, unknown>;
    return parseLockLease(resp);
  }

  /** Release a lock on `path` held under `token`. Throws ConflictError (409) if not the holder. */
  async release(path: string, token: string): Promise<boolean> {
    if (!path || !token) {
      throw new InvalidArgumentError('path and token are required');
    }
    const resp = (await this.client().delete(`/volumes/${this.volumeId}/locks`, {
      json: { path, token },
      timeout: this.timeout(),
    })) as Record<string, unknown>;
    return Boolean(resp.released ?? false);
  }

  /** Renew a lock on `path` held under `token`. Throws ConflictError (409) if not the holder. */
  async renew(path: string, token: string, ttlSeconds?: number): Promise<LockLease> {
    if (!path || !token) {
      throw new InvalidArgumentError('path and token are required');
    }
    const json: Record<string, unknown> = { path, token };
    if (ttlSeconds !== undefined) {
      json.ttl_seconds = ttlSeconds;
    }
    const resp = (await this.client().post(`/volumes/${this.volumeId}/locks/renew`, {
      json,
      timeout: this.timeout(),
    })) as Record<string, unknown>;
    // The server's renew response carries {renewed, ttl_seconds, expires_at} but
    // NOT the token (the caller already holds it). Echo the caller's token so the
    // returned lease is complete.
    return { ...parseLockLease(resp), token };
  }

  /** Query whether `path` is currently locked. */
  async status(path: string): Promise<LockStatus> {
    if (!path) {
      throw new InvalidArgumentError('path is required');
    }
    const resp = (await this.client().get(`/volumes/${this.volumeId}/locks`, {
      params: { path },
      timeout: this.timeout(),
    })) as Record<string, unknown>;
    return parseLockStatus(resp);
  }
}
