import { describe, it, expect } from 'vitest';
import {
  InjectionSensitivity,
  InjectionAction,
  createInjectionDefenseConfig,
  parseInjectionDefenseConfig,
} from '../../../src/security/injection.js';
import { InvalidArgumentError } from '../../../src/errors.js';
import { fullInjectionDefensePolicy } from '../../../src/security/policy.js';

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

describe('injectionMode field', () => {
  it('defaults to undefined when not provided', () => {
    const config = createInjectionDefenseConfig();
    expect(config.injectionMode).toBeUndefined();
  });

  it('passes through injectionMode when set via createInjectionDefenseConfig', () => {
    const config = createInjectionDefenseConfig({ injectionMode: 'strict' });
    expect(config.injectionMode).toBe('strict');
  });

  it.each(['strict', 'balanced', 'permissive', 'agentic-tool', 'data-egress-sensitive'])(
    'accepts valid mode "%s"',
    (mode) => {
      const config = createInjectionDefenseConfig({ injectionMode: mode });
      expect(config.injectionMode).toBe(mode);
    },
  );

  it('parses injection_mode from snake_case JSON key', () => {
    const config = parseInjectionDefenseConfig({ injection_mode: 'balanced' });
    expect(config.injectionMode).toBe('balanced');
  });

  it('parses injectionMode from camelCase JSON key as fallback', () => {
    const config = parseInjectionDefenseConfig({ injectionMode: 'permissive' });
    expect(config.injectionMode).toBe('permissive');
  });

  it('leaves injectionMode undefined when key is absent', () => {
    const config = parseInjectionDefenseConfig({ enabled: true });
    expect(config.injectionMode).toBeUndefined();
  });
});

describe('fullInjectionDefensePolicy', () => {
  it('enables the entire cascade in one call', () => {
    const p = fullInjectionDefensePolicy({ agentPolicy: 'summarize docs' });
    const inj = p.injectionDefense as any;
    expect(inj.enabled).toBe(true);
    expect(inj.action).toBe('block');
    expect(inj.injectionMode).toBe('balanced');
    expect(inj.judge.enabled).toBe(true);
    expect(inj.judge.policy).toBe('summarize docs');
    expect((p.customPolicy as any).enabled).toBe(true);
    expect((p.customPolicy as any).policyRef).toBe('prompt-injection@v2');
  });

  it('honors strict mode + alwaysJudge', () => {
    const p = fullInjectionDefensePolicy({ mode: 'strict', alwaysJudge: true });
    const inj = p.injectionDefense as any;
    expect(inj.injectionMode).toBe('strict');
    expect(inj.judge.always).toBe(true);
  });
});
