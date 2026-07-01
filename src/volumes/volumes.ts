import { ConnectionConfig } from '../connectionConfig.js';
import { getSharedClient } from '../api/client.js';
import { InvalidArgumentError } from '../errors.js';
import type { VolumeInfo } from './models.js';
import { parseVolumeInfo } from './models.js';
import type { VolumeRequestOpts } from './types.js';
import { VolumeFiles } from './files.js';
import { VolumeLocks } from './locks.js';

const VALID_VOLUME_ID_RE = /^[a-zA-Z0-9_-]+$/;

function assertValidVolumeId(id: string): void {
  if (!id || !VALID_VOLUME_ID_RE.test(id)) {
    throw new InvalidArgumentError(
      `Invalid volume ID: "${id}". Must be alphanumeric with hyphens/underscores only.`,
    );
  }
}

export type { VolumeRequestOpts } from './types.js';

/** Options for Volumes.create / ingest. */
export interface VolumeCreateOpts extends VolumeRequestOpts {
  /** Override the Content-Type header. Defaults to application/gzip. */
  contentType?: string;
}

/**
 * Volumes: upload a tarball once and attach it to one or many sandboxes,
 * or create file-granular volumes that support per-file read/write,
 * compare-and-swap (CAS), and advisory locks.
 *
 * Phase 1 (tarball backend): the body must be a gzip-compressed tar archive;
 * the server materializes regular-file entries inside the sandbox filesystem
 * under the attachment's mount_path. Symlinks, hardlinks, and device nodes
 * are dropped on the server for safety.
 */
export class Volumes {
  /**
   * Create a volume named `name`, optionally populated with `data`.
   *
   * `POST /volumes` is the canonical create endpoint. With `data` (a gzip tar.gz)
   * the body is ingested into a new file-granular volume (or a legacy tarball
   * blob if no file-granular backend is configured). Creating an empty volume
   * (no `data`, or an empty buffer) requires a file-granular backend.
   * `empty(name)` / `ingest(name, data)` remain available for explicit,
   * backend-specific control.
   */
  static async create(
    name: string,
    data?: Uint8Array | ArrayBuffer,
    opts?: VolumeCreateOpts,
  ): Promise<VolumeInfo> {
    if (!name) {
      throw new InvalidArgumentError('volume name is required');
    }
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      apiUrl: opts?.apiUrl,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);

    if (data === undefined || data.byteLength === 0) {
      const resp = (await client.post('/volumes', {
        params: { name },
        timeout: opts?.requestTimeout,
      })) as Record<string, unknown>;
      return parseVolumeInfo(resp);
    }

    const body = data instanceof Uint8Array ? data : new Uint8Array(data);
    const resp = (await client.post('/volumes', {
      params: { name },
      body,
      headers: { 'Content-Type': opts?.contentType ?? 'application/gzip' },
      timeout: opts?.requestTimeout,
    })) as Record<string, unknown>;
    return parseVolumeInfo(resp);
  }

  /**
   * Capture the attached volume's mount path in `sandboxId` into a NEW volume.
   *
   * The source volume is left unchanged. If `name` is omitted the server names
   * the new volume "<source-name>-commit". Returns the new VolumeInfo.
   */
  static async commit(
    sandboxId: string,
    volumeId: string,
    name?: string,
    opts?: VolumeRequestOpts,
  ): Promise<VolumeInfo> {
    if (!sandboxId || !VALID_VOLUME_ID_RE.test(sandboxId)) {
      throw new InvalidArgumentError(
        `Invalid sandbox ID: "${sandboxId}". Must be alphanumeric with hyphens/underscores only.`,
      );
    }
    assertValidVolumeId(volumeId);
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      apiUrl: opts?.apiUrl,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);
    const resp = (await client.post(`/sandboxes/${sandboxId}/volumes/${volumeId}/commit`, {
      params: name ? { name } : undefined,
      timeout: opts?.requestTimeout,
    })) as Record<string, unknown>;
    return parseVolumeInfo(resp);
  }

  /**
   * Snapshot an arbitrary absolute in-sandbox `path` into a NEW volume.
   *
   * Unlike `commit` (which captures an already-attached volume's mount path),
   * `snapshot` captures any path in the running sandbox. `name` defaults to
   * "snapshot" on the server. Synthetic paths (/proc, /sys, /dev) are rejected.
   */
  static async snapshot(
    sandboxId: string,
    path: string,
    name?: string,
    opts?: VolumeRequestOpts,
  ): Promise<VolumeInfo> {
    if (!sandboxId || !VALID_VOLUME_ID_RE.test(sandboxId)) {
      throw new InvalidArgumentError(
        `Invalid sandbox ID: "${sandboxId}". Must be alphanumeric with hyphens/underscores only.`,
      );
    }
    if (!path) {
      throw new InvalidArgumentError('path is required');
    }
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      apiUrl: opts?.apiUrl,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);
    const params: Record<string, string> = { path };
    if (name) {
      params.name = name;
    }
    const resp = (await client.post(`/sandboxes/${sandboxId}/volumes/snapshot`, {
      params,
      timeout: opts?.requestTimeout,
    })) as Record<string, unknown>;
    return parseVolumeInfo(resp);
  }

  /**
   * Create an empty file-granular volume. Requires a file-granular backend
   * (503 if not configured). Returns the new VolumeInfo.
   */
  static async empty(name: string, opts?: VolumeRequestOpts): Promise<VolumeInfo> {
    if (!name) {
      throw new InvalidArgumentError('volume name is required');
    }
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      apiUrl: opts?.apiUrl,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);
    const resp = (await client.post('/volumes/empty', {
      params: { name },
      timeout: opts?.requestTimeout,
    })) as Record<string, unknown>;
    return parseVolumeInfo(resp);
  }

  /**
   * Ingest a gzip tar.gz archive into a NEW file-granular volume. Requires a
   * file-granular backend (503 if not configured). 413 on quota exceeded.
   */
  static async ingest(
    name: string,
    data: Uint8Array | ArrayBuffer,
    opts?: VolumeCreateOpts,
  ): Promise<VolumeInfo> {
    if (!name) {
      throw new InvalidArgumentError('volume name is required');
    }
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      apiUrl: opts?.apiUrl,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);
    const body = data instanceof Uint8Array ? data : new Uint8Array(data);
    const resp = (await client.post('/volumes/ingest', {
      params: { name },
      body,
      headers: { 'Content-Type': opts?.contentType ?? 'application/gzip' },
      timeout: opts?.requestTimeout,
    })) as Record<string, unknown>;
    return parseVolumeInfo(resp);
  }

  /** Fetch metadata for a single volume. */
  static async get(volumeId: string, opts?: VolumeRequestOpts): Promise<VolumeInfo> {
    assertValidVolumeId(volumeId);
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      apiUrl: opts?.apiUrl,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);
    const resp = (await client.get(`/volumes/${volumeId}`, {
      timeout: opts?.requestTimeout,
    })) as Record<string, unknown>;
    return parseVolumeInfo(resp);
  }

  /** List all volumes owned by the caller, newest first. */
  static async list(opts?: VolumeRequestOpts): Promise<VolumeInfo[]> {
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      apiUrl: opts?.apiUrl,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);
    const resp = (await client.get('/volumes', {
      timeout: opts?.requestTimeout,
    })) as Record<string, unknown>;
    const rows = (resp.volumes as Record<string, unknown>[] | undefined) ?? [];
    return rows.map(parseVolumeInfo);
  }

  /** Download the volume's contents as raw bytes (the stored archive/blob). */
  static async download(volumeId: string, opts?: VolumeRequestOpts): Promise<Uint8Array> {
    assertValidVolumeId(volumeId);
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      apiUrl: opts?.apiUrl,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);
    return client.getBytes(`/volumes/${volumeId}/download`, {
      timeout: opts?.requestTimeout,
    });
  }

  /** Delete a volume and its blob. Idempotent on the wire. */
  static async delete(volumeId: string, opts?: VolumeRequestOpts): Promise<void> {
    assertValidVolumeId(volumeId);
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      apiUrl: opts?.apiUrl,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);
    await client.delete(`/volumes/${volumeId}`, { timeout: opts?.requestTimeout });
  }

  /**
   * File-granular operations (read/write/list/info/exists/remove/rename/mkdir,
   * plus CAS via `write(..., { ifVersion })`) on `volumeId`. File-granular
   * volumes only.
   */
  static files(volumeId: string, opts?: VolumeRequestOpts): VolumeFiles {
    return new VolumeFiles(volumeId, opts);
  }

  /** Advisory locks (acquire/release/renew/status) over a (volume, path). */
  static locks(volumeId: string, opts?: VolumeRequestOpts): VolumeLocks {
    return new VolumeLocks(volumeId, opts);
  }
}
