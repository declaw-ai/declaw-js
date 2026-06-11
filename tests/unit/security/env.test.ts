import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MASK_PATTERNS,
  createEnvSecurityConfig,
  parseEnvSecurityConfig,
  isSensitive,
} from '../../../src/security/env.js';
import type { SecureEnvVar } from '../../../src/security/env.js';

describe('DEFAULT_MASK_PATTERNS', () => {
  it('contains expected patterns', () => {
    expect(DEFAULT_MASK_PATTERNS).toContain('*_KEY');
    expect(DEFAULT_MASK_PATTERNS).toContain('*_SECRET');
    expect(DEFAULT_MASK_PATTERNS).toContain('*_TOKEN');
    expect(DEFAULT_MASK_PATTERNS).toContain('*_PASSWORD');
    expect(DEFAULT_MASK_PATTERNS).toContain('*_CREDENTIALS');
    expect(DEFAULT_MASK_PATTERNS).toContain('API_KEY');
    expect(DEFAULT_MASK_PATTERNS).toContain('SECRET_KEY');
  });
});

describe('createEnvSecurityConfig', () => {
  it('creates default config', () => {
    const config = createEnvSecurityConfig();
    expect(config.maskPatterns).toEqual(DEFAULT_MASK_PATTERNS);
    expect(config.autoMaskInAudit).toBe(true);
  });

  it('accepts overrides', () => {
    const config = createEnvSecurityConfig({
      maskPatterns: ['*_KEY'],
      autoMaskInAudit: false,
    });
    expect(config.maskPatterns).toEqual(['*_KEY']);
    expect(config.autoMaskInAudit).toBe(false);
  });

  it('does not mutate default patterns', () => {
    const config = createEnvSecurityConfig();
    config.maskPatterns.push('CUSTOM');
    const config2 = createEnvSecurityConfig();
    expect(config2.maskPatterns).not.toContain('CUSTOM');
  });
});

describe('parseEnvSecurityConfig', () => {
  it('parses snake_case keys from API/serialized JSON', () => {
    const config = parseEnvSecurityConfig({
      mask_patterns: ['*_KEY', '*_SECRET'],
      auto_mask_in_audit: false,
    });
    expect(config.maskPatterns).toEqual(['*_KEY', '*_SECRET']);
    expect(config.autoMaskInAudit).toBe(false);
  });

  it('parses camelCase keys', () => {
    const config = parseEnvSecurityConfig({
      maskPatterns: ['*_TOKEN'],
      autoMaskInAudit: true,
    });
    expect(config.maskPatterns).toEqual(['*_TOKEN']);
    expect(config.autoMaskInAudit).toBe(true);
  });

  it('defaults to DEFAULT_MASK_PATTERNS and true for missing keys', () => {
    const config = parseEnvSecurityConfig({});
    expect(config.maskPatterns).toEqual(DEFAULT_MASK_PATTERNS);
    expect(config.autoMaskInAudit).toBe(true);
  });

  it('prefers snake_case over camelCase when both present', () => {
    const config = parseEnvSecurityConfig({
      mask_patterns: ['SNAKE'],
      maskPatterns: ['CAMEL'],
    });
    expect(config.maskPatterns).toEqual(['SNAKE']);
  });
});

describe('isSensitive', () => {
  it('matches *_KEY pattern', () => {
    expect(isSensitive('AWS_ACCESS_KEY', DEFAULT_MASK_PATTERNS)).toBe(true);
    expect(isSensitive('STRIPE_KEY', DEFAULT_MASK_PATTERNS)).toBe(true);
  });

  it('matches *_SECRET pattern', () => {
    expect(isSensitive('MY_SECRET', DEFAULT_MASK_PATTERNS)).toBe(true);
  });

  it('matches *_TOKEN pattern', () => {
    expect(isSensitive('AUTH_TOKEN', DEFAULT_MASK_PATTERNS)).toBe(true);
  });

  it('matches *_PASSWORD pattern', () => {
    expect(isSensitive('DB_PASSWORD', DEFAULT_MASK_PATTERNS)).toBe(true);
  });

  it('matches *_CREDENTIALS pattern', () => {
    expect(isSensitive('AWS_CREDENTIALS', DEFAULT_MASK_PATTERNS)).toBe(true);
  });

  it('matches exact API_KEY and SECRET_KEY', () => {
    expect(isSensitive('API_KEY', DEFAULT_MASK_PATTERNS)).toBe(true);
    expect(isSensitive('SECRET_KEY', DEFAULT_MASK_PATTERNS)).toBe(true);
  });

  it('is case insensitive', () => {
    expect(isSensitive('my_api_key', DEFAULT_MASK_PATTERNS)).toBe(true);
    expect(isSensitive('auth_token', DEFAULT_MASK_PATTERNS)).toBe(true);
  });

  it('does not match non-sensitive keys', () => {
    expect(isSensitive('NODE_ENV', DEFAULT_MASK_PATTERNS)).toBe(false);
    expect(isSensitive('PORT', DEFAULT_MASK_PATTERNS)).toBe(false);
    expect(isSensitive('HOME', DEFAULT_MASK_PATTERNS)).toBe(false);
  });

  it('works with custom patterns', () => {
    expect(isSensitive('DB_HOST', ['DB_*'])).toBe(true);
    expect(isSensitive('REDIS_HOST', ['DB_*'])).toBe(false);
  });
});

describe('SecureEnvVar interface', () => {
  it('can be constructed as a typed object', () => {
    const envVar: SecureEnvVar = { key: 'API_KEY', value: 'secret123', secret: true };
    expect(envVar.key).toBe('API_KEY');
    expect(envVar.value).toBe('secret123');
    expect(envVar.secret).toBe(true);
  });
});
