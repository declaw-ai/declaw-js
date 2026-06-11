import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionConfig } from '../../src/connectionConfig.js';

describe('ConnectionConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.DECLAW_API_KEY;
    delete process.env.DECLAW_DOMAIN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses defaults when no options given', () => {
    const config = new ConnectionConfig();
    expect(config.apiKey).toBe('');
    expect(config.domain).toBe('api.declaw.ai');
    expect(config.port).toBe(443);
    expect(config.apiUrl).toBe('https://api.declaw.ai');
    expect(config.requestTimeout).toBeUndefined();
  });

  it('reads DECLAW_API_KEY from env', () => {
    process.env.DECLAW_API_KEY = 'env-key-123';
    const config = new ConnectionConfig();
    expect(config.apiKey).toBe('env-key-123');
  });

  it('reads DECLAW_DOMAIN from env', () => {
    process.env.DECLAW_DOMAIN = 'api.declaw.io';
    const config = new ConnectionConfig();
    expect(config.domain).toBe('api.declaw.io');
    expect(config.apiUrl).toBe('https://api.declaw.io');
  });

  it('opts override env vars', () => {
    process.env.DECLAW_API_KEY = 'env-key';
    const config = new ConnectionConfig({ apiKey: 'opt-key', domain: 'custom.io' });
    expect(config.apiKey).toBe('opt-key');
    expect(config.domain).toBe('custom.io');
  });

  it('uses http for non-443 ports', () => {
    const config = new ConnectionConfig({ domain: 'localhost', port: 8080 });
    expect(config.apiUrl).toBe('http://localhost:8080');
  });

  it('omits port from URL for port 80', () => {
    const config = new ConnectionConfig({ domain: 'example.com', port: 80 });
    expect(config.apiUrl).toBe('http://example.com');
  });

  it('uses apiUrl override directly', () => {
    const config = new ConnectionConfig({ apiUrl: 'http://custom:9999/v1' });
    expect(config.apiUrl).toBe('http://custom:9999/v1');
  });

  it('stores requestTimeout', () => {
    const config = new ConnectionConfig({ requestTimeout: 5000 });
    expect(config.requestTimeout).toBe(5000);
  });
});
