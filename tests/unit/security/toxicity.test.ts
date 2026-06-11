import { describe, it, expect } from 'vitest';
import {
  createToxicityConfig,
  parseToxicityConfig,
  toxicityConfigToJSON,
} from '../../../src/security/toxicity.js';
import { InvalidArgumentError } from '../../../src/errors.js';

describe('createToxicityConfig', () => {
  it('creates default config', () => {
    const config = createToxicityConfig();
    expect(config.enabled).toBe(false);
    expect(config.threshold).toBe(0.9);
    expect(config.action).toBe('block');
    expect(config.domains).toBeUndefined();
  });

  it('accepts partial overrides', () => {
    const config = createToxicityConfig({
      enabled: true,
      threshold: 0.7,
      action: 'log_only',
      domains: ['openai.com', 'anthropic.com'],
    });
    expect(config.enabled).toBe(true);
    expect(config.threshold).toBe(0.7);
    expect(config.action).toBe('log_only');
    expect(config.domains).toEqual(['openai.com', 'anthropic.com']);
  });

  it('throws on invalid threshold (too high)', () => {
    expect(() => createToxicityConfig({ threshold: 1.5 })).toThrow(InvalidArgumentError);
  });

  it('throws on invalid threshold (negative)', () => {
    expect(() => createToxicityConfig({ threshold: -0.1 })).toThrow(InvalidArgumentError);
  });

  it('throws on invalid action', () => {
    expect(() => createToxicityConfig({ action: 'nuke' as any })).toThrow(InvalidArgumentError);
  });
});

describe('parseToxicityConfig', () => {
  it('parses JSON data', () => {
    const config = parseToxicityConfig({
      enabled: true,
      threshold: 0.8,
      action: 'log_only',
      domains: ['example.com'],
    });
    expect(config.enabled).toBe(true);
    expect(config.threshold).toBe(0.8);
    expect(config.action).toBe('log_only');
    expect(config.domains).toEqual(['example.com']);
  });

  it('uses defaults for missing fields', () => {
    const config = parseToxicityConfig({});
    expect(config.enabled).toBe(false);
    expect(config.threshold).toBe(0.9);
    expect(config.action).toBe('block');
    expect(config.domains).toBeUndefined();
  });
});

describe('toxicityConfigToJSON', () => {
  it('serializes config to JSON', () => {
    const config = createToxicityConfig({
      enabled: true,
      threshold: 0.85,
      action: 'block',
      domains: ['example.com'],
    });
    const json = toxicityConfigToJSON(config);
    expect(json).toEqual({
      enabled: true,
      threshold: 0.85,
      action: 'block',
      domains: ['example.com'],
    });
  });

  it('round-trips through parse', () => {
    const original = createToxicityConfig({ enabled: true, threshold: 0.75 });
    const json = toxicityConfigToJSON(original);
    const parsed = parseToxicityConfig(json);
    expect(parsed.enabled).toBe(original.enabled);
    expect(parsed.threshold).toBe(original.threshold);
    expect(parsed.action).toBe(original.action);
    expect(parsed.domains).toEqual(original.domains);
  });
});
