import { describe, it, expect } from 'vitest';
import {
  createCodeSecurityConfig,
  parseCodeSecurityConfig,
  codeSecurityConfigToJSON,
} from '../../../src/security/codeSecurity.js';
import { InvalidArgumentError } from '../../../src/errors.js';

describe('createCodeSecurityConfig', () => {
  it('creates default config', () => {
    const config = createCodeSecurityConfig();
    expect(config.enabled).toBe(false);
    expect(config.threshold).toBe(0.6);
    expect(config.excludedLanguages).toBeUndefined();
    expect(config.action).toBe('log_only');
    expect(config.domains).toBeUndefined();
  });

  it('accepts partial overrides', () => {
    const config = createCodeSecurityConfig({
      enabled: true,
      threshold: 0.8,
      excludedLanguages: ['markdown', 'plaintext'],
      action: 'block',
    });
    expect(config.enabled).toBe(true);
    expect(config.threshold).toBe(0.8);
    expect(config.excludedLanguages).toEqual(['markdown', 'plaintext']);
    expect(config.action).toBe('block');
  });

  it('throws on invalid threshold (too high)', () => {
    expect(() => createCodeSecurityConfig({ threshold: 2.0 })).toThrow(InvalidArgumentError);
  });

  it('throws on invalid threshold (negative)', () => {
    expect(() => createCodeSecurityConfig({ threshold: -0.5 })).toThrow(InvalidArgumentError);
  });

  it('throws on invalid action', () => {
    expect(() => createCodeSecurityConfig({ action: 'destroy' as any })).toThrow(
      InvalidArgumentError,
    );
  });
});

describe('parseCodeSecurityConfig', () => {
  it('parses JSON data with snake_case keys', () => {
    const config = parseCodeSecurityConfig({
      enabled: true,
      threshold: 0.7,
      excluded_languages: ['python', 'ruby'],
      action: 'block',
    });
    expect(config.enabled).toBe(true);
    expect(config.threshold).toBe(0.7);
    expect(config.excludedLanguages).toEqual(['python', 'ruby']);
    expect(config.action).toBe('block');
  });

  it('parses JSON data with camelCase keys', () => {
    const config = parseCodeSecurityConfig({
      enabled: true,
      excludedLanguages: ['go'],
    });
    expect(config.excludedLanguages).toEqual(['go']);
  });

  it('uses defaults for missing fields', () => {
    const config = parseCodeSecurityConfig({});
    expect(config.enabled).toBe(false);
    expect(config.threshold).toBe(0.6);
    expect(config.excludedLanguages).toBeUndefined();
    expect(config.action).toBe('log_only');
    expect(config.domains).toBeUndefined();
  });
});

describe('codeSecurityConfigToJSON', () => {
  it('serializes config to snake_case JSON', () => {
    const config = createCodeSecurityConfig({
      enabled: true,
      threshold: 0.75,
      excludedLanguages: ['html'],
      action: 'block',
    });
    const json = codeSecurityConfigToJSON(config);
    expect(json).toEqual({
      enabled: true,
      threshold: 0.75,
      excluded_languages: ['html'],
      action: 'block',
    });
  });

  it('round-trips through parse', () => {
    const original = createCodeSecurityConfig({
      enabled: true,
      excludedLanguages: ['css'],
    });
    const json = codeSecurityConfigToJSON(original);
    const parsed = parseCodeSecurityConfig(json);
    expect(parsed.enabled).toBe(original.enabled);
    expect(parsed.threshold).toBe(original.threshold);
    expect(parsed.excludedLanguages).toEqual(original.excludedLanguages);
    expect(parsed.action).toBe(original.action);
  });
});
