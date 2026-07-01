import { describe, it, expect } from 'vitest';
import {
  createSecurityPolicy,
  parseSecurityPolicy,
  securityPolicyToJSON,
  requiresTlsInterception,
  fullInjectionDefensePolicy,
} from '../../../src/security/policy.js';
import { createPIIConfig } from '../../../src/security/pii.js';
import { createInjectionDefenseConfig } from '../../../src/security/injection.js';
import { createTransformationRule } from '../../../src/security/transformations.js';
import { createNetworkPolicy } from '../../../src/security/networkPolicy.js';
import { createToxicityConfig } from '../../../src/security/toxicity.js';
import { createCodeSecurityConfig } from '../../../src/security/codeSecurity.js';
import { createInvisibleTextConfig } from '../../../src/security/invisibleText.js';
import { createContentGateConfig } from '../../../src/security/contentGate.js';

describe('createSecurityPolicy', () => {
  it('creates default policy', () => {
    const policy = createSecurityPolicy();
    expect(policy.pii.enabled).toBe(false);
    expect(policy.injectionDefense).toBe(false);
    expect(policy.transformations).toEqual([]);
    expect(policy.network).toBeUndefined();
    // Audit defaults to on — matches platform behavior (events are always
    // recorded unless a caller explicitly opts out).
    expect(policy.audit).toBe(true);
    expect(policy.envSecurity.autoMaskInAudit).toBe(true);
    expect(policy.toxicity).toBeUndefined();
    expect(policy.codeSecurity).toBeUndefined();
    expect(policy.invisibleText).toBeUndefined();
    expect(policy.contentGate).toBeUndefined();
  });

  it('accepts new scanner overrides', () => {
    const toxicity = createToxicityConfig({ enabled: true, threshold: 0.8 });
    const codeSecurity = createCodeSecurityConfig({ enabled: true, action: 'block' });
    const invisibleText = createInvisibleTextConfig({ enabled: true, action: 'block' });
    const policy = createSecurityPolicy({ toxicity, codeSecurity, invisibleText });
    expect(policy.toxicity!.enabled).toBe(true);
    expect(policy.toxicity!.threshold).toBe(0.8);
    expect(policy.codeSecurity!.enabled).toBe(true);
    expect(policy.codeSecurity!.action).toBe('block');
    expect(policy.invisibleText!.enabled).toBe(true);
    expect(policy.invisibleText!.action).toBe('block');
  });

  it('accepts overrides', () => {
    const pii = createPIIConfig({ enabled: true });
    const injection = createInjectionDefenseConfig({ enabled: true });
    const network = createNetworkPolicy({ allowPublicTraffic: true });
    const policy = createSecurityPolicy({
      pii,
      injectionDefense: injection,
      network,
      audit: true,
    });
    expect(policy.pii.enabled).toBe(true);
    expect(typeof policy.injectionDefense).toBe('object');
    expect(policy.network).toBeDefined();
    expect(policy.audit).toBe(true);
  });
});

describe('requiresTlsInterception', () => {
  it('returns false for default policy', () => {
    expect(requiresTlsInterception(createSecurityPolicy())).toBe(false);
  });

  it('returns true when PII is enabled', () => {
    const policy = createSecurityPolicy({ pii: createPIIConfig({ enabled: true }) });
    expect(requiresTlsInterception(policy)).toBe(true);
  });

  it('returns true when injectionDefense is boolean true', () => {
    const policy = createSecurityPolicy({ injectionDefense: true });
    expect(requiresTlsInterception(policy)).toBe(true);
  });

  it('returns true when injectionDefense config is enabled', () => {
    const policy = createSecurityPolicy({
      injectionDefense: createInjectionDefenseConfig({ enabled: true }),
    });
    expect(requiresTlsInterception(policy)).toBe(true);
  });

  it('returns false when injectionDefense config is not enabled', () => {
    const policy = createSecurityPolicy({
      injectionDefense: createInjectionDefenseConfig({ enabled: false }),
    });
    expect(requiresTlsInterception(policy)).toBe(false);
  });

  it('returns true when transformations exist', () => {
    const rule = createTransformationRule({ match: 'x', replace: 'y' });
    const policy = createSecurityPolicy({ transformations: [rule] });
    expect(requiresTlsInterception(policy)).toBe(true);
  });

  it('returns true when toxicity is enabled', () => {
    const policy = createSecurityPolicy({
      toxicity: createToxicityConfig({ enabled: true }),
    });
    expect(requiresTlsInterception(policy)).toBe(true);
  });

  it('returns false when toxicity is disabled', () => {
    const policy = createSecurityPolicy({
      toxicity: createToxicityConfig({ enabled: false }),
    });
    expect(requiresTlsInterception(policy)).toBe(false);
  });

  it('returns true when codeSecurity is enabled', () => {
    const policy = createSecurityPolicy({
      codeSecurity: createCodeSecurityConfig({ enabled: true }),
    });
    expect(requiresTlsInterception(policy)).toBe(true);
  });

  it('returns false when codeSecurity is disabled', () => {
    const policy = createSecurityPolicy({
      codeSecurity: createCodeSecurityConfig({ enabled: false }),
    });
    expect(requiresTlsInterception(policy)).toBe(false);
  });

  it('returns true when invisibleText is enabled', () => {
    const policy = createSecurityPolicy({
      invisibleText: createInvisibleTextConfig({ enabled: true }),
    });
    expect(requiresTlsInterception(policy)).toBe(true);
  });

  it('returns false when invisibleText is disabled', () => {
    const policy = createSecurityPolicy({
      invisibleText: createInvisibleTextConfig({ enabled: false }),
    });
    expect(requiresTlsInterception(policy)).toBe(false);
  });
});

describe('parseSecurityPolicy', () => {
  it('parses minimal data', () => {
    const policy = parseSecurityPolicy({});
    expect(policy.pii.enabled).toBe(false);
    expect(policy.injectionDefense).toBe(false);
    expect(policy.transformations).toEqual([]);
    // Audit defaults to on when the field is missing from the payload —
    // matches platform behavior (events always recorded unless opted out).
    expect(policy.audit).toBe(true);
  });

  it('parses full data', () => {
    const policy = parseSecurityPolicy({
      pii: { enabled: true, types: ['ssn'], action: 'block', rehydrate_response: true },
      injection_defense: { enabled: true, sensitivity: 'high', action: 'sanitize' },
      transformations: [{ match: 'a', replace: 'b', direction: 'both' }],
      network: { allowOut: ['0.0.0.0/0'], denyOut: [], allowPublicTraffic: true },
      audit: { enabled: true },
      env_security: { maskPatterns: ['*_KEY'], autoMaskInAudit: false },
    });
    expect(policy.pii.enabled).toBe(true);
    expect(policy.pii.rehydrateResponse).toBe(true);
    expect((policy.injectionDefense as any).enabled).toBe(true);
    expect(policy.transformations).toHaveLength(1);
    expect(policy.network!.allowPublicTraffic).toBe(true);
    expect((policy.audit as any).enabled).toBe(true);
    expect(policy.envSecurity.maskPatterns).toEqual(['*_KEY']);
  });

  it('parses boolean injection_defense', () => {
    const policy = parseSecurityPolicy({ injection_defense: true });
    expect(policy.injectionDefense).toBe(true);
  });

  it('parses boolean audit', () => {
    const policy = parseSecurityPolicy({ audit: false });
    expect(policy.audit).toBe(false);
  });

  it('parses new scanner configs', () => {
    const policy = parseSecurityPolicy({
      toxicity: { enabled: true, threshold: 0.85, action: 'log_only', domains: ['example.com'] },
      code_security: { enabled: true, threshold: 0.7, excluded_languages: ['python'], action: 'block' },
      invisible_text: { enabled: true, action: 'block' },
    });
    expect(policy.toxicity!.enabled).toBe(true);
    expect(policy.toxicity!.threshold).toBe(0.85);
    expect(policy.toxicity!.action).toBe('log_only');
    expect(policy.codeSecurity!.enabled).toBe(true);
    expect(policy.codeSecurity!.excludedLanguages).toEqual(['python']);
    expect(policy.invisibleText!.enabled).toBe(true);
    expect(policy.invisibleText!.action).toBe('block');
  });

  it('leaves new scanners undefined when not provided', () => {
    const policy = parseSecurityPolicy({});
    expect(policy.toxicity).toBeUndefined();
    expect(policy.codeSecurity).toBeUndefined();
    expect(policy.invisibleText).toBeUndefined();
  });
});

describe('securityPolicyToJSON', () => {
  it('serializes policy to snake_case JSON', () => {
    const policy = createSecurityPolicy();
    const json = securityPolicyToJSON(policy);
    expect(json).toHaveProperty('pii');
    expect(json).toHaveProperty('injection_defense');
    expect(json).toHaveProperty('transformations');
    expect(json).toHaveProperty('audit');
    expect(json).toHaveProperty('env_security');
  });

  it('includes network when present', () => {
    const policy = createSecurityPolicy({ network: createNetworkPolicy() });
    const json = securityPolicyToJSON(policy);
    expect(json).toHaveProperty('network');
  });

  it('omits network when absent', () => {
    const policy = createSecurityPolicy();
    const json = securityPolicyToJSON(policy);
    expect(json).not.toHaveProperty('network');
  });

  it('round-trips through parse', () => {
    const original = createSecurityPolicy({
      pii: createPIIConfig({ enabled: true }),
      injectionDefense: true,
      audit: true,
    });
    const json = securityPolicyToJSON(original);
    const parsed = parseSecurityPolicy(json);
    expect(parsed.pii.enabled).toBe(true);
    // Boolean `true` is canonicalized to a full config object on serialize.
    expect(typeof parsed.injectionDefense).toBe('object');
    expect((parsed.injectionDefense as any).enabled).toBe(true);
    expect(typeof parsed.audit).toBe('object');
    expect((parsed.audit as any).enabled).toBe(true);
  });

  it('includes new scanner configs when present', () => {
    const policy = createSecurityPolicy({
      toxicity: createToxicityConfig({ enabled: true }),
      codeSecurity: createCodeSecurityConfig({ enabled: true, excludedLanguages: ['go'] }),
      invisibleText: createInvisibleTextConfig({ enabled: true, action: 'block' }),
    });
    const json = securityPolicyToJSON(policy);
    expect(json.toxicity).toEqual({
      enabled: true,
      threshold: 0.9,
      action: 'block',
    });
    expect(json.code_security).toEqual({
      enabled: true,
      threshold: 0.6,
      excluded_languages: ['go'],
      action: 'log_only',
    });
    expect(json.invisible_text).toEqual({
      enabled: true,
      action: 'block',
    });
  });

  it('omits new scanner configs when absent', () => {
    const policy = createSecurityPolicy();
    const json = securityPolicyToJSON(policy);
    expect(json).not.toHaveProperty('toxicity');
    expect(json).not.toHaveProperty('code_security');
    expect(json).not.toHaveProperty('invisible_text');
  });

  it('round-trips with all scanners', () => {
    const original = createSecurityPolicy({
      pii: createPIIConfig({ enabled: true }),
      toxicity: createToxicityConfig({ enabled: true, threshold: 0.75 }),
      codeSecurity: createCodeSecurityConfig({ enabled: true, action: 'block' }),
      invisibleText: createInvisibleTextConfig({ enabled: true }),
    });
    const json = securityPolicyToJSON(original);
    const parsed = parseSecurityPolicy(json);
    expect(parsed.toxicity!.enabled).toBe(true);
    expect(parsed.toxicity!.threshold).toBe(0.75);
    expect(parsed.codeSecurity!.enabled).toBe(true);
    expect(parsed.codeSecurity!.action).toBe('block');
    expect(parsed.invisibleText!.enabled).toBe(true);
    expect(parsed.invisibleText!.action).toBe('strip');
  });

  it('includes content_gate when set', () => {
    const policy = createSecurityPolicy({
      contentGate: createContentGateConfig({ enabled: true, domains: ['api.openai.com'] }),
    });
    const json = securityPolicyToJSON(policy);
    expect(json.content_gate).toEqual({ enabled: true, domains: ['api.openai.com'] });
  });

  it('omits content_gate when absent', () => {
    const policy = createSecurityPolicy();
    const json = securityPolicyToJSON(policy);
    expect(json).not.toHaveProperty('content_gate');
  });

  it('omits domains key in content_gate when domains is undefined', () => {
    const policy = createSecurityPolicy({
      contentGate: createContentGateConfig({ enabled: true }),
    });
    const json = securityPolicyToJSON(policy);
    const cg = json.content_gate as Record<string, unknown>;
    expect(cg.enabled).toBe(true);
    expect('domains' in cg).toBe(false);
  });

  it('round-trips content_gate with domains through parse', () => {
    const original = createSecurityPolicy({
      contentGate: createContentGateConfig({
        enabled: true,
        domains: ['api.openai.com', 'api.anthropic.com'],
      }),
    });
    const json = securityPolicyToJSON(original);
    const parsed = parseSecurityPolicy(json);
    expect(parsed.contentGate).toBeDefined();
    expect(parsed.contentGate!.enabled).toBe(true);
    expect(parsed.contentGate!.domains).toEqual(['api.openai.com', 'api.anthropic.com']);
  });

  it('round-trips content_gate with disabled + no domains', () => {
    const original = createSecurityPolicy({
      contentGate: createContentGateConfig({ enabled: false }),
    });
    const json = securityPolicyToJSON(original);
    const parsed = parseSecurityPolicy(json);
    expect(parsed.contentGate!.enabled).toBe(false);
    expect(parsed.contentGate!.domains).toBeUndefined();
  });

  it('serializes injection_defense domains into the "domains" key', () => {
    const policy = createSecurityPolicy({
      injectionDefense: createInjectionDefenseConfig({
        enabled: true,
        domains: ['api.example.com', '*.tools.example.com'],
      }),
    });
    const json = securityPolicyToJSON(policy);
    const inj = json.injection_defense as Record<string, unknown>;
    expect(inj.domains).toEqual(['api.example.com', '*.tools.example.com']);
  });

  it('omits domains key in injection_defense when domains is undefined', () => {
    const policy = createSecurityPolicy({
      injectionDefense: createInjectionDefenseConfig({ enabled: true }),
    });
    const json = securityPolicyToJSON(policy);
    const inj = json.injection_defense as Record<string, unknown>;
    expect(inj.enabled).toBe(true);
    expect('domains' in inj).toBe(false);
  });

  it('omits domains key in injection_defense when domains is empty', () => {
    const policy = createSecurityPolicy({
      injectionDefense: createInjectionDefenseConfig({ enabled: true, domains: [] }),
    });
    const json = securityPolicyToJSON(policy);
    const inj = json.injection_defense as Record<string, unknown>;
    expect('domains' in inj).toBe(false);
  });

  it('round-trips injection_defense domains through parse', () => {
    const original = createSecurityPolicy({
      injectionDefense: createInjectionDefenseConfig({
        enabled: true,
        domains: ['api.example.com', '~^pkg\\.'],
      }),
    });
    const json = securityPolicyToJSON(original);
    const parsed = parseSecurityPolicy(json);
    expect((parsed.injectionDefense as any).domains).toEqual(['api.example.com', '~^pkg\\.']);
  });

  it('serializes domains from fullInjectionDefensePolicy', () => {
    const policy = fullInjectionDefensePolicy({ domains: ['api.example.com'] });
    const json = securityPolicyToJSON(policy);
    const inj = json.injection_defense as Record<string, unknown>;
    expect(inj.domains).toEqual(['api.example.com']);
  });
});

describe('parseSecurityPolicy + contentGate', () => {
  it('parses content_gate from wire format', () => {
    const policy = parseSecurityPolicy({
      content_gate: { enabled: true, domains: ['api.openai.com'] },
    });
    expect(policy.contentGate).toBeDefined();
    expect(policy.contentGate!.enabled).toBe(true);
    expect(policy.contentGate!.domains).toEqual(['api.openai.com']);
  });

  it('parses content_gate without domains', () => {
    const policy = parseSecurityPolicy({
      content_gate: { enabled: false },
    });
    expect(policy.contentGate!.enabled).toBe(false);
    expect(policy.contentGate!.domains).toBeUndefined();
  });

  it('leaves contentGate undefined when absent', () => {
    const policy = parseSecurityPolicy({});
    expect(policy.contentGate).toBeUndefined();
  });

  it('accepts camelCase contentGate key', () => {
    const policy = parseSecurityPolicy({
      contentGate: { enabled: true, domains: ['example.com'] },
    });
    expect(policy.contentGate!.enabled).toBe(true);
  });
});
