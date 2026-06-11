import { describe, it, expect } from 'vitest';
import {
  PIIType,
  RedactionAction,
  createPIIConfig,
  parsePIIConfig,
} from '../../../src/security/pii.js';
import { InvalidArgumentError } from '../../../src/errors.js';

describe('PIIType enum', () => {
  it('has expected values', () => {
    expect(PIIType.SSN).toBe('ssn');
    expect(PIIType.CreditCard).toBe('credit_card');
    expect(PIIType.Email).toBe('email');
    expect(PIIType.Phone).toBe('phone');
    expect(PIIType.PersonName).toBe('person_name');
    expect(PIIType.APIKey).toBe('api_key');
    expect(PIIType.Address).toBe('address');
    expect(PIIType.IPAddress).toBe('ip_address');
  });
});

describe('RedactionAction enum', () => {
  it('has expected values', () => {
    expect(RedactionAction.Redact).toBe('redact');
    expect(RedactionAction.Block).toBe('block');
    expect(RedactionAction.LogOnly).toBe('log_only');
  });
});

describe('createPIIConfig', () => {
  it('creates default config', () => {
    const config = createPIIConfig();
    expect(config.enabled).toBe(false);
    expect(config.types).toEqual(Object.values(PIIType));
    expect(config.action).toBe(RedactionAction.Redact);
    expect(config.rehydrateResponse).toBe(true);
    expect(config.domains).toBeUndefined();
  });

  it('accepts partial overrides', () => {
    const config = createPIIConfig({
      enabled: true,
      types: [PIIType.SSN, PIIType.Email],
      action: RedactionAction.Block,
      rehydrateResponse: true,
    });
    expect(config.enabled).toBe(true);
    expect(config.types).toEqual(['ssn', 'email']);
    expect(config.action).toBe('block');
    expect(config.rehydrateResponse).toBe(true);
  });

  it('throws on invalid PII type', () => {
    expect(() => createPIIConfig({ types: ['invalid_type'] })).toThrow(InvalidArgumentError);
  });

  it('throws on invalid action', () => {
    expect(() => createPIIConfig({ action: 'nuke' })).toThrow(InvalidArgumentError);
  });
});

describe('parsePIIConfig', () => {
  it('parses JSON data', () => {
    const config = parsePIIConfig({
      enabled: true,
      types: ['ssn', 'email'],
      action: 'block',
      rehydrate_response: true,
    });
    expect(config.enabled).toBe(true);
    expect(config.types).toEqual(['ssn', 'email']);
    expect(config.action).toBe('block');
    expect(config.rehydrateResponse).toBe(true);
  });

  it('uses defaults for missing fields', () => {
    const config = parsePIIConfig({});
    expect(config.enabled).toBe(false);
    expect(config.types).toEqual(Object.values(PIIType));
    expect(config.action).toBe('redact');
    expect(config.rehydrateResponse).toBe(true);
    expect(config.domains).toBeUndefined();
  });
});
