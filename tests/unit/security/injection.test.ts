import { describe, it, expect } from 'vitest';
import {
  InjectionSensitivity,
  InjectionAction,
  createInjectionDefenseConfig,
  parseInjectionDefenseConfig,
} from '../../../src/security/injection.js';
import { InvalidArgumentError } from '../../../src/errors.js';

describe('InjectionSensitivity enum', () => {
  it('has expected values', () => {
    expect(InjectionSensitivity.Low).toBe('low');
    expect(InjectionSensitivity.Medium).toBe('medium');
    expect(InjectionSensitivity.High).toBe('high');
  });
});

describe('InjectionAction enum', () => {
  it('has expected values', () => {
    expect(InjectionAction.Block).toBe('block');
    expect(InjectionAction.LogOnly).toBe('log_only');
  });
});

describe('createInjectionDefenseConfig', () => {
  it('creates default config', () => {
    const config = createInjectionDefenseConfig();
    expect(config.enabled).toBe(false);
    expect(config.sensitivity).toBe('medium');
    expect(config.action).toBe('log_only');
    expect(config.threshold).toBe(0.8);
    expect(config.domains).toBeUndefined();
  });

  it('accepts partial overrides', () => {
    const config = createInjectionDefenseConfig({
      enabled: true,
      sensitivity: InjectionSensitivity.High,
      action: InjectionAction.Block,
    });
    expect(config.enabled).toBe(true);
    expect(config.sensitivity).toBe('high');
    expect(config.action).toBe('block');
  });

  it('throws on invalid sensitivity', () => {
    expect(() => createInjectionDefenseConfig({ sensitivity: 'extreme' })).toThrow(
      InvalidArgumentError,
    );
  });

  it('throws on invalid action', () => {
    expect(() => createInjectionDefenseConfig({ action: 'destroy' })).toThrow(
      InvalidArgumentError,
    );
  });
});

describe('parseInjectionDefenseConfig', () => {
  it('parses JSON data', () => {
    const config = parseInjectionDefenseConfig({
      enabled: true,
      sensitivity: 'high',
      action: 'block',
    });
    expect(config.enabled).toBe(true);
    expect(config.sensitivity).toBe('high');
    expect(config.action).toBe('block');
  });

  it('uses defaults for missing fields', () => {
    const config = parseInjectionDefenseConfig({});
    expect(config.enabled).toBe(false);
    expect(config.sensitivity).toBe('medium');
    expect(config.action).toBe('log_only');
    expect(config.threshold).toBe(0.8);
    expect(config.domains).toBeUndefined();
  });
});
