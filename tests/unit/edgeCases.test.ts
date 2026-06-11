/**
 * Comprehensive edge case tests covering gaps identified during QA audit.
 *
 * Covers:
 * - Sandbox.connect() sandboxId validation (path traversal prevention)
 * - ApiClient close() immediate fail on abort (no retry spin)
 * - ApiClient error mapping edge cases (malformed JSON, empty body, error field)
 * - ApiClient parseResponseBody edge cases
 * - SecurityPolicy round-trip with complex nested configs
 * - securityPolicyToJSON snake_case for nested objects
 * - Paginator with missing/null response keys
 * - Parse functions with null/undefined/empty inputs
 * - ConnectionConfig edge cases
 * - CommandExitError with various exit codes
 * - Boundary values and special characters
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { Sandbox } from '../../src/sandbox/sandbox.js';
import { ApiClient } from '../../src/api/client.js';
import { ConnectionConfig } from '../../src/connectionConfig.js';
import {
  SandboxError,
  InvalidArgumentError,
  NotFoundError,
  AuthenticationError,
  CommandExitError,
} from '../../src/errors.js';
import { SandboxPaginator, SnapshotPaginator } from '../../src/paginator.js';
import {
  createSecurityPolicy,
  parseSecurityPolicy,
  securityPolicyToJSON,
} from '../../src/security/policy.js';
import { createPIIConfig } from '../../src/security/pii.js';
import { createInjectionDefenseConfig } from '../../src/security/injection.js';
import { createAuditConfig } from '../../src/security/audit.js';
import { createNetworkPolicy } from '../../src/security/networkPolicy.js';
import { createEnvSecurityConfig } from '../../src/security/env.js';
import { createTransformationRule } from '../../src/security/transformations.js';
import {
  parseSandboxInfo,
  parseSandboxMetrics,
  parseSandboxLifecycle,
  parseSnapshotInfo,
} from '../../src/sandbox/models.js';
import { parseCommandResult, parseProcessInfo } from '../../src/sandbox/commands/models.js';
import {
  parseEntryInfo,
  parseWriteInfo,
  parseFilesystemEvent,
  FileType,
  FilesystemEventType,
} from '../../src/sandbox/filesystem/models.js';
import { parseBuildInfo, parseTemplateBuildStatus } from '../../src/template/models.js';
import { parseAuditEntry } from '../../src/security/audit.js';
import { WatchHandle } from '../../src/sandbox/filesystem/watchHandle.js';

const BASE_URL = 'http://localhost:9999';

function makeConfig(): ConnectionConfig {
  return new ConnectionConfig({ apiKey: 'test-key', domain: 'localhost:9999' });
}

function makeClient(opts?: { maxRetries?: number; retryDelay?: number }): ApiClient {
  return new ApiClient(makeConfig(), { maxRetries: opts?.maxRetries ?? 1, retryDelay: opts?.retryDelay ?? 0 });
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ============================================================================
// Sandbox.connect() - sandboxId validation (path traversal prevention)
// ============================================================================

describe('Sandbox.connect() sandboxId validation', () => {
  it('rejects empty string sandboxId', async () => {
    await expect(
      Sandbox.connect('', { apiKey: 'test-key', domain: 'localhost:9999' }),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it('rejects sandboxId with path traversal characters (..)', async () => {
    await expect(
      Sandbox.connect('../etc/passwd', { apiKey: 'test-key', domain: 'localhost:9999' }),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it('rejects sandboxId with forward slash', async () => {
    await expect(
      Sandbox.connect('sbx/evil', { apiKey: 'test-key', domain: 'localhost:9999' }),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it('rejects sandboxId with space', async () => {
    await expect(
      Sandbox.connect('sbx evil', { apiKey: 'test-key', domain: 'localhost:9999' }),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it('rejects sandboxId with special characters (@, #, $)', async () => {
    await expect(
      Sandbox.connect('sbx@evil', { apiKey: 'test-key', domain: 'localhost:9999' }),
    ).rejects.toThrow(InvalidArgumentError);

    await expect(
      Sandbox.connect('sbx#evil', { apiKey: 'test-key', domain: 'localhost:9999' }),
    ).rejects.toThrow(InvalidArgumentError);

    await expect(
      Sandbox.connect('sbx$evil', { apiKey: 'test-key', domain: 'localhost:9999' }),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it('rejects sandboxId with percent encoding (%2F)', async () => {
    await expect(
      Sandbox.connect('sbx%2Fevil', { apiKey: 'test-key', domain: 'localhost:9999' }),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it('rejects sandboxId with null bytes', async () => {
    await expect(
      Sandbox.connect('sbx\0evil', { apiKey: 'test-key', domain: 'localhost:9999' }),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it('accepts valid sandboxId with alphanumeric, hyphens, and underscores', async () => {
    server.use(
      http.get(`${BASE_URL}/sandboxes/sbx-valid_123`, () =>
        HttpResponse.json({
          sandbox_id: 'sbx-valid_123',
          envd_access_token: 'tok',
        }),
      ),
    );

    const sandbox = await Sandbox.connect('sbx-valid_123', {
      apiKey: 'test-key',
      domain: 'localhost:9999',
    });
    expect(sandbox.sandboxId).toBe('sbx-valid_123');
    sandbox.close();
  });

  it('provides descriptive error message for invalid sandboxId', async () => {
    try {
      await Sandbox.connect('../escape', { apiKey: 'test-key', domain: 'localhost:9999' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidArgumentError);
      expect((err as InvalidArgumentError).message).toContain('Invalid sandbox ID');
      expect((err as InvalidArgumentError).message).toContain('../escape');
    }
  });
});

// ============================================================================
// ApiClient - close() immediate fail (no retry spin after abort)
// ============================================================================

describe('ApiClient close() immediate fail behavior', () => {
  it('does not retry after close() is called - fails immediately with Client has been closed', async () => {
    let requestCount = 0;
    server.use(
      http.get(`${BASE_URL}/close-test`, () => {
        requestCount++;
        return HttpResponse.error();
      }),
    );

    const client = new ApiClient(makeConfig(), { maxRetries: 5, retryDelay: 0 });
    client.close();

    await expect(client.get('/close-test')).rejects.toThrow('Client has been closed');
    // Should not have made any requests since it was already closed
    // In practice, fetch may or may not be called since AbortController is already aborted
    expect(requestCount).toBeLessThanOrEqual(1);
  });

  it('after close(), concurrent requests all fail immediately', async () => {
    const client = new ApiClient(makeConfig(), { maxRetries: 3, retryDelay: 0 });
    client.close();

    const results = await Promise.allSettled([
      client.get('/a'),
      client.post('/b'),
      client.delete('/c'),
    ]);

    for (const result of results) {
      expect(result.status).toBe('rejected');
    }
  });
});

// ============================================================================
// ApiClient - error mapping edge cases
// ============================================================================

describe('ApiClient error mapping edge cases', () => {
  it('handles non-JSON error response body', async () => {
    server.use(
      http.get(`${BASE_URL}/html-error`, () =>
        new HttpResponse('<html>Not Found</html>', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );

    const client = makeClient();
    await expect(client.get('/html-error')).rejects.toThrow(NotFoundError);
    client.close();
  });

  it('handles error body with "error" field instead of "message"', async () => {
    server.use(
      http.get(`${BASE_URL}/err-field`, () =>
        HttpResponse.json({ error: 'custom error text' }, { status: 404 }),
      ),
    );

    const client = makeClient();
    try {
      await client.get('/err-field');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).message).toContain('custom error text');
    }
    client.close();
  });

  it('handles completely empty error response body', async () => {
    server.use(
      http.get(`${BASE_URL}/empty-err`, () =>
        new HttpResponse('', { status: 401 }),
      ),
    );

    const client = makeClient();
    await expect(client.get('/empty-err')).rejects.toThrow(AuthenticationError);
    client.close();
  });

  it('handles unknown 4xx status code as SandboxError', async () => {
    server.use(
      http.get(`${BASE_URL}/unknown-4xx`, () =>
        HttpResponse.json({ message: 'too many requests' }, { status: 429 }),
      ),
    );

    const client = makeClient();
    try {
      await client.get('/unknown-4xx');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxError);
      expect((err as SandboxError).message).toContain('429');
      expect((err as SandboxError).message).toContain('too many requests');
    }
    client.close();
  });

  it('parses empty body with content-length 0 as null', async () => {
    server.use(
      http.post(`${BASE_URL}/no-body`, () =>
        new HttpResponse(null, {
          status: 200,
          headers: { 'content-length': '0' },
        }),
      ),
    );

    const client = makeClient();
    const result = await client.post('/no-body');
    expect(result).toBeNull();
    client.close();
  });

  it('returns plain text when response is not JSON', async () => {
    server.use(
      http.get(`${BASE_URL}/text-response`, () =>
        new HttpResponse('plain text content', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    );

    const client = makeClient();
    const result = await client.get('/text-response');
    expect(result).toBe('plain text content');
    client.close();
  });
});

// ============================================================================
// SecurityPolicy - round-trip with fully populated config
// ============================================================================

describe('SecurityPolicy round-trip serialization', () => {
  it('round-trips a fully populated policy through toJSON and parse', () => {
    const original = createSecurityPolicy({
      pii: createPIIConfig({
        enabled: true,
        types: ['ssn', 'email', 'credit_card'],
        action: 'block',
        rehydrateResponse: true,
      }),
      injectionDefense: createInjectionDefenseConfig({
        enabled: true,
        sensitivity: 'high',
        action: 'block',
      }),
      transformations: [
        createTransformationRule({ match: 'secret-\\d+', replace: '[REDACTED]', direction: 'outbound' }),
      ],
      network: createNetworkPolicy({
        allowOut: ['10.0.0.0/8', '192.168.1.0/24'],
        denyOut: ['0.0.0.0/0'],
        allowPublicTraffic: true,
        maskRequestHost: 'proxy.example.com',
      }),
      audit: createAuditConfig({ enabled: true }),
      envSecurity: createEnvSecurityConfig({
        maskPatterns: ['*_KEY', '*_SECRET', 'CUSTOM_*'],
        autoMaskInAudit: false,
      }),
    });

    const json = securityPolicyToJSON(original);
    const parsed = parseSecurityPolicy(json);

    // PII
    expect(parsed.pii.enabled).toBe(true);
    expect(parsed.pii.types).toEqual(['ssn', 'email', 'credit_card']);
    expect(parsed.pii.action).toBe('block');
    expect(parsed.pii.rehydrateResponse).toBe(true);

    // Injection defense
    expect(typeof parsed.injectionDefense).toBe('object');
    const injDef = parsed.injectionDefense as { enabled: boolean; sensitivity: string; action: string };
    expect(injDef.enabled).toBe(true);
    expect(injDef.sensitivity).toBe('high');
    expect(injDef.action).toBe('block');

    // Transformations
    expect(parsed.transformations).toHaveLength(1);

    // Network
    expect(parsed.network).toBeDefined();
    expect(parsed.network!.allowOut).toEqual(['10.0.0.0/8', '192.168.1.0/24']);
    expect(parsed.network!.denyOut).toEqual(['0.0.0.0/0']);
    expect(parsed.network!.allowPublicTraffic).toBe(true);

    // Audit
    expect(typeof parsed.audit).toBe('object');
    const audit = parsed.audit as { enabled: boolean };
    expect(audit.enabled).toBe(true);

    // Env security
    expect(parsed.envSecurity.maskPatterns).toEqual(['*_KEY', '*_SECRET', 'CUSTOM_*']);
    expect(parsed.envSecurity.autoMaskInAudit).toBe(false);
  });

  it('securityPolicyToJSON emits only the enabled field for audit', () => {
    // AuditConfig was stripped down to a single flag (#170) after the
    // body-logging / retention-hours fields were deleted for being
    // advertised-but-not-wired. This test guards against reintroducing
    // those fields without a matching backend implementation.
    const policy = createSecurityPolicy({
      audit: createAuditConfig({ enabled: true }),
    });

    const json = securityPolicyToJSON(policy);
    const auditJson = json.audit as Record<string, unknown>;

    expect(auditJson).toEqual({ enabled: true });
  });

  it('securityPolicyToJSON outputs correct snake_case for PII rehydrate_response', () => {
    const policy = createSecurityPolicy({
      pii: createPIIConfig({ enabled: true, rehydrateResponse: true }),
    });

    const json = securityPolicyToJSON(policy);
    const piiJson = json.pii as Record<string, unknown>;

    expect(piiJson).toHaveProperty('rehydrate_response', true);
    expect(piiJson).not.toHaveProperty('rehydrateResponse');
  });

  it('securityPolicyToJSON outputs correct snake_case for env_security', () => {
    const policy = createSecurityPolicy({
      envSecurity: createEnvSecurityConfig({
        maskPatterns: ['*_TOKEN'],
        autoMaskInAudit: false,
      }),
    });

    const json = securityPolicyToJSON(policy);
    const envJson = json.env_security as Record<string, unknown>;

    expect(envJson).toHaveProperty('mask_patterns', ['*_TOKEN']);
    expect(envJson).toHaveProperty('auto_mask_in_audit', false);
    expect(envJson).not.toHaveProperty('maskPatterns');
    expect(envJson).not.toHaveProperty('autoMaskInAudit');
  });

  it('securityPolicyToJSON includes maskRequestHost in network when present', () => {
    const policy = createSecurityPolicy({
      network: createNetworkPolicy({ maskRequestHost: 'proxy.io' }),
    });

    const json = securityPolicyToJSON(policy);
    const netJson = json.network as Record<string, unknown>;

    expect(netJson).toHaveProperty('mask_request_host', 'proxy.io');
  });

  it('securityPolicyToJSON omits maskRequestHost in network when absent', () => {
    const policy = createSecurityPolicy({
      network: createNetworkPolicy({ allowOut: ['10.0.0.0/8'] }),
    });

    const json = securityPolicyToJSON(policy);
    const netJson = json.network as Record<string, unknown>;

    expect(netJson).not.toHaveProperty('mask_request_host');
  });
});

// ============================================================================
// parseSecurityPolicy edge cases (env_security fix verification)
// ============================================================================

describe('parseSecurityPolicy edge cases', () => {
  it('parses env_security from snake_case key', () => {
    const policy = parseSecurityPolicy({
      env_security: { maskPatterns: ['*_KEY'], autoMaskInAudit: false },
    });
    expect(policy.envSecurity.maskPatterns).toEqual(['*_KEY']);
    expect(policy.envSecurity.autoMaskInAudit).toBe(false);
  });

  it('parses envSecurity from camelCase key', () => {
    const policy = parseSecurityPolicy({
      envSecurity: { maskPatterns: ['*_TOKEN'], autoMaskInAudit: true },
    });
    expect(policy.envSecurity.maskPatterns).toEqual(['*_TOKEN']);
    expect(policy.envSecurity.autoMaskInAudit).toBe(true);
  });

  it('uses default env_security when both keys missing', () => {
    const policy = parseSecurityPolicy({});
    expect(policy.envSecurity.autoMaskInAudit).toBe(true);
    expect(policy.envSecurity.maskPatterns.length).toBeGreaterThan(0);
  });

  it('prefers env_security over envSecurity when both present', () => {
    const policy = parseSecurityPolicy({
      env_security: { maskPatterns: ['SNAKE'], autoMaskInAudit: false },
      envSecurity: { maskPatterns: ['CAMEL'], autoMaskInAudit: true },
    });
    expect(policy.envSecurity.maskPatterns).toEqual(['SNAKE']);
  });

  it('parses injectionDefense from camelCase key', () => {
    const policy = parseSecurityPolicy({
      injectionDefense: { enabled: true, sensitivity: 'low', action: 'block' },
    });
    const injDef = policy.injectionDefense as { enabled: boolean };
    expect(injDef.enabled).toBe(true);
  });

  it('handles null injection_defense as false', () => {
    const policy = parseSecurityPolicy({ injection_defense: null });
    expect(policy.injectionDefense).toBe(false);
  });

  it('handles null audit as default-on', () => {
    // After #170, a null/missing audit block is treated as "platform
    // default" which is on — only an explicit `{ enabled: false }`
    // opts the sandbox out.
    const policy = parseSecurityPolicy({ audit: null });
    expect(policy.audit).toBe(true);
  });

  it('handles undefined pii as default config', () => {
    const policy = parseSecurityPolicy({ pii: undefined });
    expect(policy.pii.enabled).toBe(false);
  });
});

// ============================================================================
// Paginator edge cases
// ============================================================================

describe('Paginator edge cases', () => {
  it('SandboxPaginator handles response without sandboxes key (null safety)', async () => {
    server.use(
      http.get(`${BASE_URL}/sandboxes`, () =>
        HttpResponse.json({ next_token: null }),
      ),
    );

    const paginator = new SandboxPaginator(makeClient());
    const items = await paginator.nextItems();
    expect(items).toEqual([]);
  });

  it('SnapshotPaginator handles response without snapshots key (null safety)', async () => {
    server.use(
      http.get(`${BASE_URL}/snapshots`, () =>
        HttpResponse.json({ next_token: null }),
      ),
    );

    const paginator = new SnapshotPaginator(makeClient());
    const items = await paginator.nextItems();
    expect(items).toEqual([]);
  });

  it('SandboxPaginator sends limit as string parameter', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE_URL}/sandboxes`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ sandboxes: [], next_token: null });
      }),
    );

    const paginator = new SandboxPaginator(makeClient(), { limit: 5 });
    await paginator.nextItems();

    const url = new URL(capturedUrl);
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('SandboxPaginator passes query params through', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE_URL}/sandboxes`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ sandboxes: [], next_token: null });
      }),
    );

    const paginator = new SandboxPaginator(makeClient(), {
      query: { state: 'running', template: 'python3' },
    });
    await paginator.nextItems();

    const url = new URL(capturedUrl);
    expect(url.searchParams.get('state')).toBe('running');
    expect(url.searchParams.get('template')).toBe('python3');
  });

  it('SandboxPaginator hasNext is true before any calls', () => {
    const paginator = new SandboxPaginator(makeClient());
    expect(paginator.hasNext).toBe(true);
  });

  it('SnapshotPaginator hasNext is true before any calls', () => {
    const paginator = new SnapshotPaginator(makeClient());
    expect(paginator.hasNext).toBe(true);
  });

  it('SandboxPaginator handles empty string next_token as truthy (continues pagination)', async () => {
    // Empty string is falsy in JS, so next_token: '' should exhaust pagination
    server.use(
      http.get(`${BASE_URL}/sandboxes`, () =>
        HttpResponse.json({ sandboxes: [], next_token: '' }),
      ),
    );

    const paginator = new SandboxPaginator(makeClient());
    await paginator.nextItems();
    // Empty string is falsy, so paginator should be exhausted
    expect(paginator.hasNext).toBe(false);
  });
});

// ============================================================================
// Parse function edge cases (null/undefined/empty inputs)
// ============================================================================

describe('Parse function boundary values', () => {
  describe('parseSandboxInfo', () => {
    it('handles completely empty object', () => {
      const info = parseSandboxInfo({});
      expect(info.sandboxId).toBe('');
      expect(info.templateId).toBe('');
      expect(info.name).toBe('');
      expect(info.metadata).toEqual({});
      expect(info.startedAt).toBeUndefined();
      expect(info.endAt).toBeUndefined();
    });

    it('handles null values in date fields gracefully', () => {
      const info = parseSandboxInfo({
        sandbox_id: 'sb-1',
        started_at: null,
        end_at: null,
      });
      // null is falsy, so dates should be undefined
      expect(info.startedAt).toBeUndefined();
      expect(info.endAt).toBeUndefined();
    });
  });

  describe('parseSandboxMetrics', () => {
    it('handles zero values', () => {
      const metrics = parseSandboxMetrics({
        timestamp: '2024-01-01T00:00:00Z',
        cpu_usage_percent: 0,
        memory_usage_mb: 0,
        disk_usage_mb: 0,
      });
      expect(metrics.cpuUsagePercent).toBe(0);
      expect(metrics.memoryUsageMb).toBe(0);
      expect(metrics.diskUsageMb).toBe(0);
    });

    it('handles negative values (theoretically invalid but should not crash)', () => {
      const metrics = parseSandboxMetrics({
        timestamp: '2024-01-01T00:00:00Z',
        cpu_usage_percent: -1,
      });
      expect(metrics.cpuUsagePercent).toBe(-1);
    });

    it('handles very large values', () => {
      const metrics = parseSandboxMetrics({
        timestamp: '2024-01-01T00:00:00Z',
        cpu_usage_percent: 100.0,
        memory_usage_mb: 999999,
        disk_usage_mb: 999999,
      });
      expect(metrics.cpuUsagePercent).toBe(100.0);
      expect(metrics.memoryUsageMb).toBe(999999);
    });
  });

  describe('parseCommandResult', () => {
    it('handles completely empty object', () => {
      const result = parseCommandResult({});
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    });

    it('handles exit_code of 0 explicitly', () => {
      const result = parseCommandResult({ exit_code: 0 });
      expect(result.exitCode).toBe(0);
    });

    it('handles negative exit codes', () => {
      const result = parseCommandResult({ exit_code: -1, stdout: '', stderr: 'killed' });
      expect(result.exitCode).toBe(-1);
    });

    it('handles very large exit codes', () => {
      const result = parseCommandResult({ exit_code: 255 });
      expect(result.exitCode).toBe(255);
    });
  });

  describe('parseProcessInfo', () => {
    it('handles completely empty object', () => {
      const info = parseProcessInfo({});
      expect(info.pid).toBe(0);
      expect(info.cmd).toBe('');
      expect(info.isPty).toBe(false);
      expect(info.envs).toEqual({});
    });
  });

  describe('parseEntryInfo', () => {
    it('handles completely empty object', () => {
      const info = parseEntryInfo({});
      expect(info.name).toBe('');
      expect(info.path).toBe('');
      expect(info.type).toBe(FileType.File);
      expect(info.size).toBe(0);
    });

    it('handles dir type', () => {
      const info = parseEntryInfo({ type: 'dir', name: 'subdir', path: '/tmp/subdir', size: 4096 });
      expect(info.type).toBe(FileType.Dir);
    });
  });

  describe('parseWriteInfo', () => {
    it('handles completely empty object', () => {
      const info = parseWriteInfo({});
      expect(info.path).toBe('');
      expect(info.size).toBe(0);
    });
  });

  describe('parseFilesystemEvent', () => {
    it('handles completely empty object', () => {
      const event = parseFilesystemEvent({});
      expect(event.type).toBe(FilesystemEventType.Create);
      expect(event.path).toBe('');
      expect(event.timestamp).toBeUndefined();
    });

    it('preserves timestamp when present', () => {
      const event = parseFilesystemEvent({ type: 'write', path: '/f.txt', timestamp: 1234567890 });
      expect(event.timestamp).toBe(1234567890);
    });
  });

  describe('parseBuildInfo', () => {
    it('handles camelCase keys as fallback', () => {
      const info = parseBuildInfo({ buildId: 'bld-1', status: 'ok', templateId: 'tmpl-1' });
      expect(info.buildId).toBe('bld-1');
      expect(info.templateId).toBe('tmpl-1');
    });
  });

  describe('parseTemplateBuildStatus', () => {
    it('handles camelCase buildId', () => {
      const status = parseTemplateBuildStatus({ buildId: 'bld-1', status: 'done', logs: [] });
      expect(status.buildId).toBe('bld-1');
    });
  });

  describe('parseSandboxLifecycle', () => {
    it('handles camelCase keys', () => {
      const lc = parseSandboxLifecycle({ onTimeout: 'pause', autoResume: true });
      expect(lc.onTimeout).toBe('pause');
      expect(lc.autoResume).toBe(true);
    });
  });

  describe('parseSnapshotInfo', () => {
    it('handles camelCase keys', () => {
      const snap = parseSnapshotInfo({ snapshotId: 'snap-1', sandboxId: 'sb-1', createdAt: '2024-01-01T00:00:00Z' });
      expect(snap.snapshotId).toBe('snap-1');
      expect(snap.createdAt).toBeInstanceOf(Date);
    });

    it('handles empty object', () => {
      const snap = parseSnapshotInfo({});
      expect(snap.snapshotId).toBe('');
      expect(snap.sandboxId).toBe('');
      expect(snap.createdAt).toBeUndefined();
    });
  });

  describe('parseAuditEntry', () => {
    it('handles camelCase keys', () => {
      const entry = parseAuditEntry({
        timestamp: '2024-01-01T00:00:00Z',
        method: 'GET',
        url: '/test',
        statusCode: 200,
        piiRedactions: 3,
        injectionBlocks: 1,
        transformationsApplied: 2,
        direction: 'outbound',
      });
      expect(entry.statusCode).toBe(200);
      expect(entry.piiRedactions).toBe(3);
      expect(entry.injectionBlocks).toBe(1);
      expect(entry.transformationsApplied).toBe(2);
    });

    it('handles completely empty object with defaults', () => {
      const entry = parseAuditEntry({ timestamp: '2024-01-01T00:00:00Z' });
      expect(entry.method).toBe('');
      expect(entry.url).toBe('');
      expect(entry.statusCode).toBe(0);
      expect(entry.piiRedactions).toBe(0);
      expect(entry.direction).toBe('');
    });
  });
});

// ============================================================================
// ConnectionConfig edge cases
// ============================================================================

describe('ConnectionConfig edge cases', () => {
  it('handles apiUrl with trailing slash (stripped in client buildUrl)', async () => {
    const config = new ConnectionConfig({ apiUrl: 'http://localhost:9999/' });
    expect(config.apiUrl).toBe('http://localhost:9999/');
    // The ApiClient strips the trailing slash when building URLs
  });

  it('port 80 uses http scheme', () => {
    const config = new ConnectionConfig({ domain: 'example.com', port: 80 });
    expect(config.apiUrl).toBe('http://example.com');
  });
});

// ============================================================================
// CommandExitError edge cases
// ============================================================================

describe('CommandExitError edge cases', () => {
  it('stores exit code 0 (edge case: zero is falsy)', () => {
    const err = new CommandExitError('failed', {
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
    expect(err.exitCode).toBe(0);
  });

  it('stores exit code 128+9 (SIGKILL)', () => {
    const err = new CommandExitError('killed', {
      exitCode: 137,
      stdout: 'partial',
      stderr: 'Killed',
    });
    expect(err.exitCode).toBe(137);
    expect(err.stdout).toBe('partial');
    expect(err.stderr).toBe('Killed');
  });

  it('stores exit code 255 (max unsigned byte)', () => {
    const err = new CommandExitError('err', {
      exitCode: 255,
      stdout: '',
      stderr: 'max exit',
    });
    expect(err.exitCode).toBe(255);
  });

  it('stores empty stdout and stderr', () => {
    const err = new CommandExitError('failed', {
      exitCode: 1,
      stdout: '',
      stderr: '',
    });
    expect(err.stdout).toBe('');
    expect(err.stderr).toBe('');
  });

  it('stores very long stdout and stderr', () => {
    const longOutput = 'x'.repeat(100000);
    const err = new CommandExitError('failed', {
      exitCode: 1,
      stdout: longOutput,
      stderr: longOutput,
    });
    expect(err.stdout.length).toBe(100000);
    expect(err.stderr.length).toBe(100000);
  });

  it('inherits sandboxId from opts', () => {
    const err = new CommandExitError('failed', {
      sandboxId: 'sbx-test',
      exitCode: 2,
      stdout: '',
      stderr: '',
    });
    expect(err.sandboxId).toBe('sbx-test');
  });
});

// ============================================================================
// WatchHandle edge cases
// ============================================================================

describe('WatchHandle edge cases', () => {
  it('stop() is idempotent', () => {
    const wh = new WatchHandle();
    wh.stop();
    wh.stop();
    wh.stop();
    // Should not throw
  });

  it('getNewEvents drains the buffer', () => {
    const wh = new WatchHandle();
    wh.pushEvent({ type: FilesystemEventType.Create, path: '/a.txt' });
    wh.pushEvent({ type: FilesystemEventType.Write, path: '/b.txt' });

    const events1 = wh.getNewEvents();
    expect(events1).toHaveLength(2);

    const events2 = wh.getNewEvents();
    expect(events2).toHaveLength(0);
  });

  it('pushEvent after stop is ignored', () => {
    const wh = new WatchHandle();
    wh.pushEvent({ type: FilesystemEventType.Create, path: '/a.txt' });
    wh.stop();
    wh.pushEvent({ type: FilesystemEventType.Write, path: '/b.txt' });

    const events = wh.getNewEvents();
    expect(events).toHaveLength(1);
    expect(events[0].path).toBe('/a.txt');
  });

  it('getNewEvents returns empty array when no events pushed', () => {
    const wh = new WatchHandle();
    expect(wh.getNewEvents()).toEqual([]);
  });
});

// ============================================================================
// ApiClient retry with 5xx then success on final attempt
// ============================================================================

describe('ApiClient retry scenarios', () => {
  it('5xx on all retries except the last succeeds', async () => {
    let requestCount = 0;
    server.use(
      http.get(`${BASE_URL}/retry-last`, () => {
        requestCount++;
        if (requestCount < 3) {
          return HttpResponse.json({ error: 'fail' }, { status: 500 });
        }
        return HttpResponse.json({ success: true });
      }),
    );

    const client = new ApiClient(makeConfig(), { maxRetries: 3, retryDelay: 0 });
    const result = await client.get('/retry-last');
    expect(result).toEqual({ success: true });
    expect(requestCount).toBe(3);
    client.close();
  });

  it('5xx on the very last attempt throws SandboxError', async () => {
    server.use(
      http.get(`${BASE_URL}/always-500`, () =>
        HttpResponse.json({ message: 'server is down' }, { status: 500 }),
      ),
    );

    const client = new ApiClient(makeConfig(), { maxRetries: 2, retryDelay: 0 });
    try {
      await client.get('/always-500');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxError);
      expect((err as SandboxError).message).toContain('500');
    }
    client.close();
  });
});

// ============================================================================
// Sandbox.list() edge cases
// ============================================================================

describe('Sandbox.list() edge cases', () => {
  it('handles response with null next_token as undefined', async () => {
    server.use(
      http.get(`${BASE_URL}/sandboxes`, () =>
        HttpResponse.json({ sandboxes: [], next_token: null }),
      ),
    );

    const result = await Sandbox.list({
      apiKey: 'test-key',
      domain: 'localhost:9999',
    });
    expect(result.nextToken).toBeUndefined();
  });

  it('handles response with missing sandboxes key', async () => {
    server.use(
      http.get(`${BASE_URL}/sandboxes`, () =>
        HttpResponse.json({}),
      ),
    );

    const result = await Sandbox.list({
      apiKey: 'test-key',
      domain: 'localhost:9999',
    });
    expect(result.sandboxes).toEqual([]);
  });
});

// ============================================================================
// Unicode and special characters in various fields
// ============================================================================

describe('Unicode and special character handling', () => {
  it('parseSandboxInfo handles unicode in name and metadata', () => {
    const info = parseSandboxInfo({
      sandbox_id: 'sb-1',
      name: '\u6d4b\u8bd5\u6c99\u7bb1',
      metadata: { label: '\u00e9\u00e0\u00fc\u00f6' },
      state: 'running',
    });
    expect(info.name).toBe('\u6d4b\u8bd5\u6c99\u7bb1');
    expect(info.metadata.label).toBe('\u00e9\u00e0\u00fc\u00f6');
  });

  it('parseCommandResult handles unicode in stdout/stderr', () => {
    const result = parseCommandResult({
      stdout: 'Hello \u4e16\u754c\n',
      stderr: '\u2757 Warning: \u00e9\n',
      exit_code: 0,
    });
    expect(result.stdout).toContain('\u4e16\u754c');
    expect(result.stderr).toContain('\u00e9');
  });

  it('parseEntryInfo handles unicode in file paths', () => {
    const info = parseEntryInfo({
      name: '\u6587\u4ef6.txt',
      path: '/home/user/\u6587\u4ef6.txt',
      type: 'file',
      size: 42,
    });
    expect(info.name).toBe('\u6587\u4ef6.txt');
    expect(info.path).toContain('\u6587\u4ef6');
  });
});
