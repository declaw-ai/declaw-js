import type { SandboxNetworkOpts } from '../sandbox/network.js';

/** Network policy for a sandbox security configuration. */
export interface NetworkPolicy {
  allowOut: string[];
  denyOut: string[];
  allowPublicTraffic: boolean;
  maskRequestHost?: string;
}

/**
 * Create a NetworkPolicy with defaults.
 */
export function createNetworkPolicy(opts?: Partial<NetworkPolicy>): NetworkPolicy {
  return {
    allowOut: opts?.allowOut ?? [],
    denyOut: opts?.denyOut ?? [],
    allowPublicTraffic: opts?.allowPublicTraffic ?? true,
    maskRequestHost: opts?.maskRequestHost,
  };
}

/**
 * Parse raw JSON data into a NetworkPolicy.
 * Handles both snake_case (from API/serialization) and camelCase keys.
 */
export function parseNetworkPolicy(data: Record<string, any>): NetworkPolicy {
  return {
    allowOut: data.allow_out ?? data.allowOut ?? [],
    denyOut: data.deny_out ?? data.denyOut ?? [],
    allowPublicTraffic: data.allow_public_traffic ?? data.allowPublicTraffic ?? true,
    maskRequestHost: data.mask_request_host ?? data.maskRequestHost,
  };
}

/**
 * Serialize a NetworkPolicy to a JSON-friendly object.
 * Omits empty allow/deny lists and only emits allow_public_traffic when false,
 * matching the Python SDK's to_dict behavior.
 */
export function networkPolicyToJSON(policy: NetworkPolicy): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (policy.allowOut.length > 0) {
    result.allow_out = policy.allowOut;
  }
  if (policy.denyOut.length > 0) {
    result.deny_out = policy.denyOut;
  }
  if (!policy.allowPublicTraffic) {
    result.allow_public_traffic = false;
  }
  if (policy.maskRequestHost !== undefined) {
    result.mask_request_host = policy.maskRequestHost;
  }
  return result;
}

/**
 * Convert a NetworkPolicy to SandboxNetworkOpts.
 */
export function networkPolicyToOpts(policy: NetworkPolicy): SandboxNetworkOpts {
  return {
    allowOut: policy.allowOut,
    denyOut: policy.denyOut,
    allowPublicTraffic: policy.allowPublicTraffic,
    maskRequestHost: policy.maskRequestHost,
  };
}
