import { describe, it, expect } from 'vitest';
import {
  createInvisibleTextConfig,
  parseInvisibleTextConfig,
  invisibleTextConfigToJSON,
} from '../../../src/security/invisibleText.js';
import { InvalidArgumentError } from '../../../src/errors.js';

describe('createInvisibleTextConfig', () => {
  it('creates default config', () => {
    const config = createInvisibleTextConfig();
    expect(config.enabled).toBe(false);
    expect(config.action).toBe('strip');
  });

  it('accepts partial overrides', () => {
    const config = createInvisibleTextConfig({
      enabled: true,
      action: 'block',
    });
    expect(config.enabled).toBe(true);
    expect(config.action).toBe('block');
  });

  it('accepts log_only action', () => {
    const config = createInvisibleTextConfig({ action: 'log_only' });
    expect(config.action).toBe('log_only');
  });

  it('throws on invalid action', () => {
    expect(() => createInvisibleTextConfig({ action: 'ignore' as any })).toThrow(
      InvalidArgumentError,
    );
  });
});

describe('parseInvisibleTextConfig', () => {
  it('parses JSON data', () => {
    const config = parseInvisibleTextConfig({
      enabled: true,
      action: 'block',
    });
    expect(config.enabled).toBe(true);
    expect(config.action).toBe('block');
  });

  it('uses defaults for missing fields', () => {
    const config = parseInvisibleTextConfig({});
    expect(config.enabled).toBe(false);
    expect(config.action).toBe('strip');
  });
});

describe('invisibleTextConfigToJSON', () => {
  it('serializes config to JSON', () => {
    const config = createInvisibleTextConfig({
      enabled: true,
      action: 'strip',
    });
    const json = invisibleTextConfigToJSON(config);
    expect(json).toEqual({
      enabled: true,
      action: 'strip',
    });
  });

  it('round-trips through parse', () => {
    const original = createInvisibleTextConfig({ enabled: true, action: 'block' });
    const json = invisibleTextConfigToJSON(original);
    const parsed = parseInvisibleTextConfig(json);
    expect(parsed.enabled).toBe(original.enabled);
    expect(parsed.action).toBe(original.action);
  });
});
