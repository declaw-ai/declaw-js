import { describe, it, expect } from 'vitest';
import {
  createContentGateConfig,
  parseContentGateConfig,
  contentGateConfigToJSON,
} from '../../../src/security/contentGate.js';

describe('createContentGateConfig', () => {
  it('creates default config', () => {
    const config = createContentGateConfig();
    expect(config.enabled).toBe(false);
    expect(config.domains).toBeUndefined();
  });

  it('accepts enabled=true with no domains', () => {
    const config = createContentGateConfig({ enabled: true });
    expect(config.enabled).toBe(true);
    expect(config.domains).toBeUndefined();
  });

  it('accepts enabled=true with domain list', () => {
    const config = createContentGateConfig({
      enabled: true,
      domains: ['api.openai.com', 'api.anthropic.com'],
    });
    expect(config.enabled).toBe(true);
    expect(config.domains).toEqual(['api.openai.com', 'api.anthropic.com']);
  });

  it('accepts disabled=false with domains still set', () => {
    const config = createContentGateConfig({ enabled: false, domains: ['api.openai.com'] });
    expect(config.enabled).toBe(false);
    expect(config.domains).toEqual(['api.openai.com']);
  });
});

describe('parseContentGateConfig', () => {
  it('parses enabled + domains', () => {
    const config = parseContentGateConfig({
      enabled: true,
      domains: ['api.openai.com', 'huggingface.co'],
    });
    expect(config.enabled).toBe(true);
    expect(config.domains).toEqual(['api.openai.com', 'huggingface.co']);
  });

  it('uses defaults for missing fields', () => {
    const config = parseContentGateConfig({});
    expect(config.enabled).toBe(false);
    expect(config.domains).toBeUndefined();
  });

  it('parses domains as undefined when absent', () => {
    const config = parseContentGateConfig({ enabled: true });
    expect(config.domains).toBeUndefined();
  });
});

describe('contentGateConfigToJSON', () => {
  it('serializes enabled=true with domains', () => {
    const config = createContentGateConfig({
      enabled: true,
      domains: ['api.openai.com'],
    });
    const json = contentGateConfigToJSON(config);
    expect(json).toEqual({
      enabled: true,
      domains: ['api.openai.com'],
    });
  });

  it('omits domains key when undefined', () => {
    const config = createContentGateConfig({ enabled: true });
    const json = contentGateConfigToJSON(config);
    expect(json).toEqual({ enabled: true });
    expect('domains' in json).toBe(false);
  });

  it('serializes enabled=false with no domains', () => {
    const config = createContentGateConfig();
    const json = contentGateConfigToJSON(config);
    expect(json.enabled).toBe(false);
    expect('domains' in json).toBe(false);
  });

  it('round-trips through parse', () => {
    const original = createContentGateConfig({
      enabled: true,
      domains: ['api.openai.com', 'api.anthropic.com', 'huggingface.co'],
    });
    const json = contentGateConfigToJSON(original);
    const parsed = parseContentGateConfig(json);
    expect(parsed.enabled).toBe(original.enabled);
    expect(parsed.domains).toEqual(original.domains);
  });

  it('round-trips disabled config with no domains', () => {
    const original = createContentGateConfig({ enabled: false });
    const json = contentGateConfigToJSON(original);
    const parsed = parseContentGateConfig(json);
    expect(parsed.enabled).toBe(false);
    expect(parsed.domains).toBeUndefined();
  });
});
