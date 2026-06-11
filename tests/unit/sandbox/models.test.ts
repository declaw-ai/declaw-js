import { describe, it, expect } from 'vitest';
import {
  SandboxState,
  parseSandboxInfo,
  parseSandboxMetrics,
  parseSandboxLifecycle,
  parseSnapshotInfo,
} from '../../../src/sandbox/models.js';

describe('SandboxState enum', () => {
  it('has all expected values', () => {
    expect(SandboxState.Running).toBe('running');
    expect(SandboxState.Paused).toBe('paused');
    expect(SandboxState.Creating).toBe('creating');
    expect(SandboxState.Killed).toBe('killed');
  });
});

describe('parseSandboxInfo', () => {
  it('parses snake_case keys', () => {
    const info = parseSandboxInfo({
      sandbox_id: 'sb-1',
      template_id: 'tmpl-1',
      name: 'test-sandbox',
      metadata: { env: 'dev' },
      started_at: '2024-01-15T10:00:00Z',
      end_at: '2024-01-15T11:00:00Z',
      state: 'running',
    });
    expect(info.sandboxId).toBe('sb-1');
    expect(info.templateId).toBe('tmpl-1');
    expect(info.name).toBe('test-sandbox');
    expect(info.metadata).toEqual({ env: 'dev' });
    expect(info.startedAt).toBeInstanceOf(Date);
    expect(info.startedAt!.toISOString()).toBe('2024-01-15T10:00:00.000Z');
    expect(info.endAt).toBeInstanceOf(Date);
    expect(info.state).toBe(SandboxState.Running);
  });

  it('handles missing optional dates', () => {
    const info = parseSandboxInfo({
      sandbox_id: 'sb-2',
      template_id: 'tmpl-2',
      name: 'no-dates',
      metadata: {},
      state: 'paused',
    });
    expect(info.startedAt).toBeUndefined();
    expect(info.endAt).toBeUndefined();
  });

  it('handles camelCase keys', () => {
    const info = parseSandboxInfo({
      sandboxId: 'sb-3',
      templateId: 'tmpl-3',
      name: 'camel',
      metadata: {},
      startedAt: '2024-06-01T00:00:00Z',
      state: 'creating',
    });
    expect(info.sandboxId).toBe('sb-3');
    expect(info.templateId).toBe('tmpl-3');
    expect(info.startedAt).toBeInstanceOf(Date);
  });

  it('uses defaults for missing fields', () => {
    const info = parseSandboxInfo({});
    expect(info.sandboxId).toBe('');
    expect(info.templateId).toBe('');
    expect(info.name).toBe('');
    expect(info.metadata).toEqual({});
    expect(info.state).toBe(SandboxState.Running);
  });
});

describe('parseSandboxMetrics', () => {
  it('parses snake_case keys', () => {
    const metrics = parseSandboxMetrics({
      timestamp: '2024-01-15T10:30:00Z',
      cpu_usage_percent: 45.5,
      memory_usage_mb: 256,
      disk_usage_mb: 1024,
    });
    expect(metrics.timestamp).toBeInstanceOf(Date);
    expect(metrics.cpuUsagePercent).toBe(45.5);
    expect(metrics.memoryUsageMb).toBe(256);
    expect(metrics.diskUsageMb).toBe(1024);
  });

  it('defaults numeric fields to 0', () => {
    const metrics = parseSandboxMetrics({ timestamp: '2024-01-01T00:00:00Z' });
    expect(metrics.cpuUsagePercent).toBe(0);
    expect(metrics.memoryUsageMb).toBe(0);
    expect(metrics.diskUsageMb).toBe(0);
  });
});

describe('parseSandboxLifecycle', () => {
  it('parses snake_case keys', () => {
    const lc = parseSandboxLifecycle({ on_timeout: 'pause', auto_resume: true });
    expect(lc.onTimeout).toBe('pause');
    expect(lc.autoResume).toBe(true);
  });

  it('uses defaults', () => {
    const lc = parseSandboxLifecycle({});
    expect(lc.onTimeout).toBe('kill');
    expect(lc.autoResume).toBe(false);
  });
});

describe('parseSnapshotInfo', () => {
  it('parses snake_case keys with date', () => {
    const snap = parseSnapshotInfo({
      snapshot_id: 'snap-1',
      sandbox_id: 'sb-1',
      created_at: '2024-03-01T12:00:00Z',
    });
    expect(snap.snapshotId).toBe('snap-1');
    expect(snap.sandboxId).toBe('sb-1');
    expect(snap.createdAt).toBeInstanceOf(Date);
  });

  it('handles missing createdAt', () => {
    const snap = parseSnapshotInfo({ snapshot_id: 'snap-2', sandbox_id: 'sb-2' });
    expect(snap.createdAt).toBeUndefined();
  });
});
