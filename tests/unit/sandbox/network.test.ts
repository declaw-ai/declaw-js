import { describe, it, expect } from 'vitest';
import {
  ALL_TRAFFIC,
  validateNetworkEntry,
  domainMatches,
} from '../../../src/sandbox/network.js';
import { InvalidArgumentError } from '../../../src/errors.js';

describe('ALL_TRAFFIC', () => {
  it('is 0.0.0.0/0', () => {
    expect(ALL_TRAFFIC).toBe('0.0.0.0/0');
  });
});

describe('validateNetworkEntry', () => {
  it('accepts valid IPv4', () => {
    expect(validateNetworkEntry('192.168.1.1')).toBe('192.168.1.1');
    expect(validateNetworkEntry('0.0.0.0')).toBe('0.0.0.0');
    expect(validateNetworkEntry('255.255.255.255')).toBe('255.255.255.255');
  });

  it('accepts valid CIDR', () => {
    expect(validateNetworkEntry('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(validateNetworkEntry('192.168.0.0/16')).toBe('192.168.0.0/16');
    expect(validateNetworkEntry('0.0.0.0/0')).toBe('0.0.0.0/0');
  });

  it('rejects invalid IPv4', () => {
    expect(() => validateNetworkEntry('999.1.1.1')).toThrow(InvalidArgumentError);
    expect(() => validateNetworkEntry('1.2.3')).toThrow(InvalidArgumentError);
    expect(() => validateNetworkEntry('abc')).toThrow(InvalidArgumentError);
  });

  it('rejects invalid CIDR', () => {
    expect(() => validateNetworkEntry('10.0.0.0/33')).toThrow(InvalidArgumentError);
    expect(() => validateNetworkEntry('300.0.0.0/8')).toThrow(InvalidArgumentError);
  });

  it('rejects empty string', () => {
    expect(() => validateNetworkEntry('')).toThrow(InvalidArgumentError);
    expect(() => validateNetworkEntry('  ')).toThrow(InvalidArgumentError);
  });

  it('rejects domains by default', () => {
    expect(() => validateNetworkEntry('example.com')).toThrow(InvalidArgumentError);
  });

  it('accepts domains when allowDomains is true', () => {
    expect(validateNetworkEntry('example.com', { allowDomains: true })).toBe('example.com');
    expect(validateNetworkEntry('sub.example.com', { allowDomains: true })).toBe('sub.example.com');
    expect(validateNetworkEntry('*.example.com', { allowDomains: true })).toBe('*.example.com');
  });

  it('trims whitespace', () => {
    expect(validateNetworkEntry('  10.0.0.1  ')).toBe('10.0.0.1');
  });
});

describe('domainMatches', () => {
  it('matches exact domain', () => {
    expect(domainMatches('example.com', 'example.com')).toBe(true);
  });

  it('is case insensitive', () => {
    expect(domainMatches('Example.COM', 'example.com')).toBe(true);
  });

  it('does not match different domains', () => {
    expect(domainMatches('example.com', 'other.com')).toBe(false);
  });

  it('matches wildcard subdomain', () => {
    expect(domainMatches('*.example.com', 'foo.example.com')).toBe(true);
    expect(domainMatches('*.example.com', 'bar.example.com')).toBe(true);
  });

  it('wildcard matches the base domain itself', () => {
    expect(domainMatches('*.example.com', 'example.com')).toBe(true);
  });

  it('wildcard matches nested subdomains', () => {
    expect(domainMatches('*.example.com', 'a.b.example.com')).toBe(true);
  });

  it('wildcard does not match unrelated domain', () => {
    expect(domainMatches('*.example.com', 'notexample.com')).toBe(false);
  });
});
