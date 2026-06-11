/**
 * Toggle for per-sandbox audit logging.
 *
 * When enabled, Declaw records lifecycle, network, command, filesystem,
 * snapshot, and security events. Set `enabled: false` to suppress all
 * gated categories; only lifecycle and admin events are still recorded.
 *
 * Retention is a platform-wide setting (global 7-day default), not a
 * per-sandbox knob. Body logging is not user-configurable today.
 */
export interface AuditConfig {
  enabled: boolean;
}

/** Create an AuditConfig with defaults (enabled=true). */
export function createAuditConfig(opts?: Partial<AuditConfig>): AuditConfig {
  return {
    enabled: opts?.enabled ?? true,
  };
}

/** Parse raw JSON data into AuditConfig. Defaults to enabled=true when the field is absent. */
export function parseAuditConfig(data: Record<string, any>): AuditConfig {
  return {
    enabled: data.enabled ?? true,
  };
}

/** A single audit log entry. */
export interface AuditEntry {
  timestamp: Date;
  method: string;
  url: string;
  statusCode: number;
  piiRedactions: number;
  injectionBlocks: number;
  transformationsApplied: number;
  direction: string;
}

/** Parse raw JSON data into an AuditEntry. */
export function parseAuditEntry(data: Record<string, any>): AuditEntry {
  return {
    timestamp: new Date(data.timestamp),
    method: data.method ?? '',
    url: data.url ?? '',
    statusCode: data.status_code ?? data.statusCode ?? 0,
    piiRedactions: data.pii_redactions ?? data.piiRedactions ?? 0,
    injectionBlocks: data.injection_blocks ?? data.injectionBlocks ?? 0,
    transformationsApplied: data.transformations_applied ?? data.transformationsApplied ?? 0,
    direction: data.direction ?? '',
  };
}
