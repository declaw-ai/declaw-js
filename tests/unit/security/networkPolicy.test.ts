import { describe, it, expect } from 'vitest';
import {
  createNetworkPolicy,
  parseNetworkPolicy,
  networkPolicyToOpts,
  networkPolicyToJSON,
} from '../../../src/security/networkPolicy.js';

describe('createNetworkPolicy', () => {
  it('creates default policy', () => {
    const policy = createNetworkPolicy();
    expect(policy.allowOut).toEqual([]);
    expect(policy.denyOut).toEqual([]);
    expect(policy.allowPublicTraffic).toBe(true);
    expect(policy.maskRequestHost).toBeUndefined();
  });

  it('accepts partial overrides', () => {
    const policy = createNetworkPolicy({
      allowOut: ['10.0.0.0/8'],
      denyOut: ['192.168.1.0/24'],
      allowPublicTraffic: true,
      maskRequestHost: 'proxy.declaw.io',
    });
    expect(policy.allowOut).toEqual(['10.0.0.0/8']);
    expect(policy.denyOut).toEqual(['192.168.1.0/24']);
    expect(policy.allowPublicTraffic).toBe(true);
    expect(policy.maskRequestHost).toBe('proxy.declaw.io');
  });
});

describe('parseNetworkPolicy', () => {
  it('parses snake_case keys from API/serialized JSON', () => {
    const policy = parseNetworkPolicy({
      allow_out: ['10.0.0.0/8'],
      deny_out: ['0.0.0.0/0'],
      allow_public_traffic: true,
      mask_request_host: 'proxy.io',
    });
    expect(policy.allowOut).toEqual(['10.0.0.0/8']);
    expect(policy.denyOut).toEqual(['0.0.0.0/0']);
    expect(policy.allowPublicTraffic).toBe(true);
    expect(policy.maskRequestHost).toBe('proxy.io');
  });

  it('parses camelCase keys', () => {
    const policy = parseNetworkPolicy({
      allowOut: ['192.168.0.0/16'],
      denyOut: [],
      allowPublicTraffic: false,
    });
    expect(policy.allowOut).toEqual(['192.168.0.0/16']);
    expect(policy.denyOut).toEqual([]);
    expect(policy.allowPublicTraffic).toBe(false);
  });

  it('defaults to empty arrays and true for missing keys', () => {
    const policy = parseNetworkPolicy({});
    expect(policy.allowOut).toEqual([]);
    expect(policy.denyOut).toEqual([]);
    expect(policy.allowPublicTraffic).toBe(true);
    expect(policy.maskRequestHost).toBeUndefined();
  });

  it('prefers snake_case over camelCase when both present', () => {
    const policy = parseNetworkPolicy({
      allow_out: ['snake'],
      allowOut: ['camel'],
    });
    expect(policy.allowOut).toEqual(['snake']);
  });
});

describe('networkPolicyToOpts', () => {
  it('converts policy to SandboxNetworkOpts', () => {
    const policy = createNetworkPolicy({
      allowOut: ['0.0.0.0/0'],
      denyOut: [],
      allowPublicTraffic: true,
      maskRequestHost: 'mask.io',
    });
    const opts = networkPolicyToOpts(policy);
    expect(opts.allowOut).toEqual(['0.0.0.0/0']);
    expect(opts.denyOut).toEqual([]);
    expect(opts.allowPublicTraffic).toBe(true);
    expect(opts.maskRequestHost).toBe('mask.io');
  });

  it('preserves undefined maskRequestHost', () => {
    const policy = createNetworkPolicy();
    const opts = networkPolicyToOpts(policy);
    expect(opts.maskRequestHost).toBeUndefined();
  });
});

describe('networkPolicyToJSON', () => {
  it('omits empty allow/deny lists and default allow_public_traffic', () => {
    const json = networkPolicyToJSON(createNetworkPolicy());
    expect(json).toEqual({});
  });

  it('emits allow_public_traffic only when false', () => {
    const json = networkPolicyToJSON(createNetworkPolicy({ allowPublicTraffic: false }));
    expect(json).toEqual({ allow_public_traffic: false });
  });

  it('emits non-empty allow/deny lists and mask_request_host', () => {
    const json = networkPolicyToJSON(
      createNetworkPolicy({
        allowOut: ['10.0.0.0/8'],
        denyOut: ['0.0.0.0/0'],
        allowPublicTraffic: false,
        maskRequestHost: 'proxy.io',
      }),
    );
    expect(json).toEqual({
      allow_out: ['10.0.0.0/8'],
      deny_out: ['0.0.0.0/0'],
      allow_public_traffic: false,
      mask_request_host: 'proxy.io',
    });
  });
});
