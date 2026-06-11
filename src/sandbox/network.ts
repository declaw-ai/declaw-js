import { InvalidArgumentError } from '../errors.js';

/** CIDR for all traffic. */
export const ALL_TRAFFIC = '0.0.0.0/0';

/** Network configuration options for a sandbox. */
export interface SandboxNetworkOpts {
  allowOut: string[];
  denyOut: string[];
  allowPublicTraffic: boolean;
  maskRequestHost?: string;
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const CIDR_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
const DOMAIN_RE = /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

function isValidIPv4(ip: string): boolean {
  const match = IPV4_RE.exec(ip);
  if (!match) return false;
  for (let i = 1; i <= 4; i++) {
    const octet = parseInt(match[i], 10);
    if (octet < 0 || octet > 255) return false;
  }
  return true;
}

function isValidCIDR(cidr: string): boolean {
  const match = CIDR_RE.exec(cidr);
  if (!match) return false;
  for (let i = 1; i <= 4; i++) {
    const octet = parseInt(match[i], 10);
    if (octet < 0 || octet > 255) return false;
  }
  const prefix = parseInt(match[5], 10);
  return prefix >= 0 && prefix <= 32;
}

/**
 * Validate a network entry. Returns the normalized entry string.
 * Accepts IPv4 addresses, CIDR notation, and optionally domain names.
 * Throws InvalidArgumentError on invalid input.
 */
export function validateNetworkEntry(
  entry: string,
  opts?: { allowDomains?: boolean },
): string {
  const trimmed = entry.trim();
  if (!trimmed) {
    throw new InvalidArgumentError('Network entry cannot be empty');
  }

  if (isValidIPv4(trimmed)) {
    return trimmed;
  }

  if (isValidCIDR(trimmed)) {
    return trimmed;
  }

  if (opts?.allowDomains && DOMAIN_RE.test(trimmed)) {
    return trimmed;
  }

  throw new InvalidArgumentError(
    `Invalid network entry: "${trimmed}". Expected a valid IPv4 address, CIDR block${opts?.allowDomains ? ', or domain name' : ''}`,
  );
}

/**
 * Check if a hostname matches a domain pattern.
 * Supports exact match and wildcard patterns like `*.example.com`.
 */
export function domainMatches(pattern: string, hostname: string): boolean {
  const p = pattern.toLowerCase();
  const h = hostname.toLowerCase();

  if (p === h) return true;

  if (p.startsWith('*.')) {
    const suffix = p.slice(2);
    // Match the suffix itself (e.g., *.example.com matches example.com)
    if (h === suffix) return true;
    // Match subdomains (e.g., *.example.com matches foo.example.com)
    if (h.endsWith('.' + suffix)) return true;
  }

  return false;
}
