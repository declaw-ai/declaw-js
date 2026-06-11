import { describe, it, expect } from 'vitest';
import {
  createCustomPolicyConfig,
  parseCustomPolicyConfig,
  customPolicyConfigToJSON,
} from '../../../src/security/customPolicy.js';
import {
  createSecurityPolicy,
  parseSecurityPolicy,
  securityPolicyToJSON,
} from '../../../src/security/policy.js';

describe('createCustomPolicyConfig', () => {
  it('creates config with defaults', () => {
    const config = createCustomPolicyConfig();
    expect(config.enabled).toBe(false);
    expect(config.inlineRego).toBeUndefined();
    expect(config.inlineModules).toBeUndefined();
    expect(config.policyRef).toBeUndefined();
    expect(config.defaultDeny).toBe(false);
  });

  it('passes through inlineModules', () => {
    const modules = [
      'package cmd\ndeny_command contains msg if { msg := "blocked" }',
      'package network\ndeny_egress contains msg if { msg := "blocked" }',
    ];
    const config = createCustomPolicyConfig({
      enabled: true,
      inlineModules: modules,
    });
    expect(config.inlineModules).toEqual(modules);
  });

  it('passes through both inlineRego and inlineModules', () => {
    const config = createCustomPolicyConfig({
      enabled: true,
      inlineRego: 'package main\ndefault allow = false',
      inlineModules: ['package helper\ndefault ok = true'],
    });
    expect(config.inlineRego).toBe('package main\ndefault allow = false');
    expect(config.inlineModules).toEqual(['package helper\ndefault ok = true']);
  });
});

describe('customPolicyConfigToJSON', () => {
  it('emits inline_rego as snake_case', () => {
    const config = createCustomPolicyConfig({
      enabled: true,
      inlineRego: 'package main\ndefault allow = false',
    });
    const json = customPolicyConfigToJSON(config);
    expect(json).toHaveProperty('inline_rego', 'package main\ndefault allow = false');
    expect(json).not.toHaveProperty('inlineRego');
  });

  it('emits inline_modules as snake_case', () => {
    const modules = [
      'package cmd\ndeny_command contains msg if { msg := "blocked" }',
      'package network\ndeny_egress contains msg if { msg := "blocked" }',
    ];
    const config = createCustomPolicyConfig({
      enabled: true,
      inlineModules: modules,
    });
    const json = customPolicyConfigToJSON(config);
    expect(json).toHaveProperty('inline_modules', modules);
    expect(json).not.toHaveProperty('inlineModules');
  });

  it('emits both inline_rego and inline_modules together', () => {
    const config = createCustomPolicyConfig({
      enabled: true,
      inlineRego: 'package main\ndefault allow = false',
      inlineModules: ['package helper\ndefault ok = true'],
      defaultDeny: true,
    });
    const json = customPolicyConfigToJSON(config);
    expect(json.enabled).toBe(true);
    expect(json.inline_rego).toBe('package main\ndefault allow = false');
    expect(json.inline_modules).toEqual(['package helper\ndefault ok = true']);
    expect(json.default_deny).toBe(true);
  });

  it('omits inline_modules from JSON.stringify output when undefined', () => {
    const config = createCustomPolicyConfig({ enabled: true });
    const json = customPolicyConfigToJSON(config);
    // JSON.stringify drops undefined values — inline_modules should not appear
    const serialized = JSON.parse(JSON.stringify(json));
    expect(serialized).not.toHaveProperty('inline_modules');
  });
});

describe('parseCustomPolicyConfig', () => {
  it('reads inline_modules from snake_case wire key', () => {
    const modules = ['package cmd\ndefault allow = false'];
    const config = parseCustomPolicyConfig({
      enabled: true,
      inline_rego: 'package main\ndefault allow = false',
      inline_modules: modules,
      default_deny: true,
    });
    expect(config.inlineModules).toEqual(modules);
    expect(config.inlineRego).toBe('package main\ndefault allow = false');
    expect(config.defaultDeny).toBe(true);
  });

  it('falls back to camelCase inlineModules when snake_case absent', () => {
    const modules = ['package cmd\ndefault allow = false'];
    const config = parseCustomPolicyConfig({
      enabled: true,
      inlineModules: modules,
    });
    expect(config.inlineModules).toEqual(modules);
  });

  it('leaves inlineModules undefined when neither key present', () => {
    const config = parseCustomPolicyConfig({ enabled: true });
    expect(config.inlineModules).toBeUndefined();
  });
});

describe('customPolicyConfig round-trip', () => {
  it('round-trips inlineRego and inlineModules through to/from JSON', () => {
    const modules = [
      'package cmd\ndeny_command contains msg if { msg := "blocked" }',
      'package network\ndeny_egress contains msg if { msg := "blocked" }',
    ];
    const original = createCustomPolicyConfig({
      enabled: true,
      inlineRego: 'package main\ndefault allow = false',
      inlineModules: modules,
      defaultDeny: true,
    });

    const json = customPolicyConfigToJSON(original);
    const parsed = parseCustomPolicyConfig(json);

    expect(parsed.enabled).toBe(true);
    expect(parsed.inlineRego).toBe('package main\ndefault allow = false');
    expect(parsed.inlineModules).toEqual(modules);
    expect(parsed.defaultDeny).toBe(true);
  });
});

describe('SecurityPolicy with customPolicy including inlineModules', () => {
  it('round-trips customPolicy with inlineModules through securityPolicyToJSON / parseSecurityPolicy', () => {
    const modules = [
      'package cmd\ndeny_command contains msg if { msg := "blocked" }',
      'package network\ndeny_egress contains msg if { msg := "blocked" }',
    ];
    const original = createSecurityPolicy({
      customPolicy: createCustomPolicyConfig({
        enabled: true,
        inlineRego: 'package main\ndefault allow = false',
        inlineModules: modules,
        defaultDeny: true,
      }),
    });

    const json = securityPolicyToJSON(original);

    // Wire format must use snake_case keys
    expect(json.custom_policy).toBeDefined();
    expect(json.custom_policy.inline_rego).toBe('package main\ndefault allow = false');
    expect(json.custom_policy.inline_modules).toEqual(modules);
    expect(json.custom_policy.default_deny).toBe(true);

    // Must parse back correctly
    const parsed = parseSecurityPolicy(json);
    expect(parsed.customPolicy).toBeDefined();
    expect(parsed.customPolicy!.inlineRego).toBe('package main\ndefault allow = false');
    expect(parsed.customPolicy!.inlineModules).toEqual(modules);
    expect(parsed.customPolicy!.defaultDeny).toBe(true);
  });

  it('omits custom_policy from wire format when absent', () => {
    const policy = createSecurityPolicy();
    const json = securityPolicyToJSON(policy);
    expect(json).not.toHaveProperty('custom_policy');
  });
});
