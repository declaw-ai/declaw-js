/** Live-mount / copy mode for a volume attachment on Sandbox.create. */
export type VolumeAttachMode = 'copy' | 'mount' | 'mount-ro';

/** Request-side shape of a volume attachment on Sandbox.create. */
export interface VolumeAttachment {
  volumeId: string;
  mountPath: string;
  /**
   * Attach mode. `copy` (default) hydrates the volume into the sandbox
   * filesystem at boot. `mount` is a read-write live NFS mount; `mount-ro`
   * is a read-only live mount. Omitted from the wire when unset (server
   * defaults to copy).
   */
  mode?: VolumeAttachMode;
  /**
   * Relative path within the volume to mount. LIVE-MOUNT ONLY — the server
   * rejects a subpath on a copy-mode attachment.
   */
  subpath?: string;
}

/** Server-side metadata for a single volume. */
export interface VolumeInfo {
  volumeId: string;
  ownerId: string;
  name: string;
  blobKey: string;
  sizeBytes: number;
  contentType: string;
  metadata: Record<string, string>;
  createdAt: string;
  /** Storage backend ("tarball" or a file-granular backend). */
  backend: string;
  /** Per-volume quota in bytes (0 = unset/unlimited). */
  quotaBytes: number;
  /** Last-modified timestamp (ISO 8601). */
  updatedAt: string;
}

/** A single directory entry inside a file-granular volume (volumefs.Entry). */
export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modTime: string;
  mode: number;
}

/** A file entry plus the CAS token returned by `info`/`stat`. */
export interface FileInfo extends FileEntry {
  /** CAS token to round-trip into a conditional write's `ifVersion`. */
  version: string;
}

/** Result of acquiring or renewing a lock. */
export interface LockLease {
  token: string;
  ttlSeconds: number;
  expiresAt: string;
}

/** Result of querying lock status. */
export interface LockStatus {
  held: boolean;
  expiresInMs: number;
}

/** Convert a wire-format volume row into a VolumeInfo. */
export function parseVolumeInfo(data: Record<string, unknown>): VolumeInfo {
  return {
    volumeId: String(data.volume_id ?? ''),
    ownerId: String(data.owner_id ?? ''),
    name: String(data.name ?? ''),
    blobKey: String(data.blob_key ?? ''),
    sizeBytes: Number(data.size_bytes ?? 0),
    contentType: String(data.content_type ?? ''),
    metadata: (data.metadata as Record<string, string> | null | undefined) ?? {},
    createdAt: String(data.created_at ?? ''),
    backend: String(data.backend ?? ''),
    quotaBytes: Number(data.quota_bytes ?? 0),
    updatedAt: String(data.updated_at ?? ''),
  };
}

/** Convert a wire-format file entry into a FileEntry. */
export function parseFileEntry(data: Record<string, unknown>): FileEntry {
  return {
    name: String(data.name ?? ''),
    path: String(data.path ?? ''),
    isDir: Boolean(data.is_dir ?? false),
    size: Number(data.size ?? 0),
    modTime: String(data.mod_time ?? ''),
    mode: Number(data.mode ?? 0),
  };
}

/** Convert a wire-format stat response into a FileInfo (FileEntry + version). */
export function parseFileInfo(data: Record<string, unknown>): FileInfo {
  return {
    ...parseFileEntry(data),
    version: String(data.version ?? ''),
  };
}

/** Convert a wire-format lock lease into a LockLease. */
export function parseLockLease(data: Record<string, unknown>): LockLease {
  return {
    token: String(data.token ?? ''),
    ttlSeconds: Number(data.ttl_seconds ?? 0),
    expiresAt: String(data.expires_at ?? ''),
  };
}

/** Convert a wire-format lock status into a LockStatus. */
export function parseLockStatus(data: Record<string, unknown>): LockStatus {
  return {
    held: Boolean(data.held ?? false),
    expiresInMs: Number(data.expires_in_ms ?? 0),
  };
}

/** Render a VolumeAttachment in wire (snake_case) form. */
export function volumeAttachmentToJSON(att: VolumeAttachment): Record<string, string> {
  const out: Record<string, string> = {
    volume_id: att.volumeId,
    mount_path: att.mountPath,
  };
  if (att.mode) {
    out.mode = att.mode;
  }
  if (att.subpath) {
    out.subpath = att.subpath;
  }
  return out;
}
