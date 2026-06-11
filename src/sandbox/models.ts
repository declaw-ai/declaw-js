/** State of a sandbox. */
export enum SandboxState {
  Running = 'running',
  Paused = 'paused',
  Creating = 'creating',
  Killed = 'killed',
}

/** Information about a sandbox. */
export interface SandboxInfo {
  sandboxId: string;
  templateId: string;
  name: string;
  metadata: Record<string, string>;
  startedAt?: Date;
  endAt?: Date;
  state: SandboxState;
}

/** Parse raw JSON data into a SandboxInfo. */
export function parseSandboxInfo(data: Record<string, any>): SandboxInfo {
  return {
    sandboxId: data.sandbox_id ?? data.sandboxId ?? '',
    templateId: data.template_id ?? data.templateId ?? '',
    name: data.name ?? '',
    metadata: data.metadata ?? {},
    startedAt: data.started_at || data.startedAt ? new Date(data.started_at ?? data.startedAt) : undefined,
    endAt: data.end_at || data.endAt ? new Date(data.end_at ?? data.endAt) : undefined,
    state: (data.state as SandboxState) ?? SandboxState.Running,
  };
}

/** Metrics for a sandbox. */
export interface SandboxMetrics {
  timestamp: Date;
  cpuUsagePercent: number;
  memoryUsageMb: number;
  diskUsageMb: number;
}

/** Parse raw JSON data into SandboxMetrics. */
export function parseSandboxMetrics(data: Record<string, any>): SandboxMetrics {
  return {
    timestamp: new Date(data.timestamp),
    cpuUsagePercent: data.cpu_usage_percent ?? data.cpuUsagePercent ?? 0,
    memoryUsageMb: data.memory_usage_mb ?? data.memoryUsageMb ?? 0,
    diskUsageMb: data.disk_usage_mb ?? data.diskUsageMb ?? 0,
  };
}

/** Query filters for listing sandboxes. */
export interface SandboxQuery {
  metadata?: Record<string, string>;
  state?: SandboxState[];
}

/** Lifecycle configuration for a sandbox. */
export interface SandboxLifecycle {
  onTimeout: string;
  autoResume: boolean;
}

/** Parse raw JSON data into SandboxLifecycle. */
export function parseSandboxLifecycle(data: Record<string, any>): SandboxLifecycle {
  return {
    onTimeout: data.on_timeout ?? data.onTimeout ?? 'kill',
    autoResume: data.auto_resume ?? data.autoResume ?? false,
  };
}

/** Information about a snapshot. */
export interface SnapshotInfo {
  snapshotId: string;
  sandboxId: string;
  createdAt?: Date;
}

/** Parse raw JSON data into SnapshotInfo. */
export function parseSnapshotInfo(data: Record<string, any>): SnapshotInfo {
  return {
    snapshotId: data.snapshot_id ?? data.snapshotId ?? '',
    sandboxId: data.sandbox_id ?? data.sandboxId ?? '',
    createdAt: data.created_at || data.createdAt ? new Date(data.created_at ?? data.createdAt) : undefined,
  };
}

/** Source kind for a sandbox snapshot. */
export type SnapshotSource = 'periodic' | 'pause' | 'manual';

/**
 * Full metadata for a manual/pause/periodic sandbox snapshot,
 * as returned by POST /sandboxes/:id/snapshot and
 * GET /sandboxes/:id/snapshots.
 */
export interface Snapshot {
  snapshotId: string;
  sandboxId: string;
  /** Which lifecycle created the snapshot: periodic, pause, or manual. */
  source: SnapshotSource;
  memBlobKey: string;
  vmstateBlobKey: string;
  memSizeBytes?: number;
  pauseDurationMs?: number;
  createdAt: string;
}

/** Parse raw JSON data into a Snapshot. */
export function parseSnapshot(data: Record<string, any>): Snapshot {
  return {
    snapshotId: data.snapshot_id ?? data.snapshotId ?? '',
    sandboxId: data.sandbox_id ?? data.sandboxId ?? '',
    source: (data.source as SnapshotSource) ?? 'manual',
    memBlobKey: data.mem_blob_key ?? data.memBlobKey ?? '',
    vmstateBlobKey: data.vmstate_blob_key ?? data.vmstateBlobKey ?? '',
    memSizeBytes: data.mem_size_bytes ?? data.memSizeBytes,
    pauseDurationMs: data.pause_duration_ms ?? data.pauseDurationMs,
    createdAt: data.created_at ?? data.createdAt ?? '',
  };
}
