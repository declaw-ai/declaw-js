import { describe, it, expect } from 'vitest';
import {
  createAuditConfig,
  parseAuditConfig,
  parseAuditEntry,
} from '../../../src/security/audit.js';

describe('createAuditConfig', () => {
  it('defaults to enabled', () => {
    const config = createAuditConfig();
    expect(config.enabled).toBe(true);
  });

  it('accepts explicit opt-out', () => {
    expect(createAuditConfig({ enabled: false }).enabled).toBe(false);
  });
});

describe('parseAuditConfig', () => {
  it('reads enabled from payload', () => {
    expect(parseAuditConfig({ enabled: false }).enabled).toBe(false);
    expect(parseAuditConfig({ enabled: true }).enabled).toBe(true);
  });

  it('defaults to enabled when field is absent', () => {
    // Older SDK clients may not send the field at all; preserve current
    // behavior (audit on) rather than surprising them with silent opt-out.
    expect(parseAuditConfig({}).enabled).toBe(true);
  });
});

describe('parseAuditEntry', () => {
  it('parses snake_case keys', () => {
    const entry = parseAuditEntry({
      timestamp: '2024-06-15T08:30:00Z',
      method: 'POST',
      url: '/sandboxes',
      status_code: 201,
      pii_redactions: 3,
      injection_blocks: 0,
      transformations_applied: 1,
      direction: 'outbound',
    });
    expect(entry.timestamp).toBeInstanceOf(Date);
    expect(entry.timestamp.toISOString()).toBe('2024-06-15T08:30:00.000Z');
    expect(entry.method).toBe('POST');
    expect(entry.url).toBe('/sandboxes');
    expect(entry.statusCode).toBe(201);
    expect(entry.piiRedactions).toBe(3);
    expect(entry.injectionBlocks).toBe(0);
    expect(entry.transformationsApplied).toBe(1);
    expect(entry.direction).toBe('outbound');
  });

  it('uses defaults for missing numeric fields', () => {
    const entry = parseAuditEntry({
      timestamp: '2024-01-01T00:00:00Z',
      method: 'GET',
      url: '/',
    });
    expect(entry.statusCode).toBe(0);
    expect(entry.piiRedactions).toBe(0);
    expect(entry.injectionBlocks).toBe(0);
    expect(entry.transformationsApplied).toBe(0);
    expect(entry.direction).toBe('');
  });
});
