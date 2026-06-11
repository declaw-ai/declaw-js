/** Default patterns for masking sensitive environment variables. */
export const DEFAULT_MASK_PATTERNS = [
  '*_KEY',
  '*_SECRET',
  '*_TOKEN',
  '*_PASSWORD',
  '*_CREDENTIALS',
  'API_KEY',
  'SECRET_KEY',
];

/** Configuration for environment variable security. */
export interface EnvSecurityConfig {
  maskPatterns: string[];
  autoMaskInAudit: boolean;
}

/**
 * Create an EnvSecurityConfig with defaults.
 */
export function createEnvSecurityConfig(opts?: Partial<EnvSecurityConfig>): EnvSecurityConfig {
  return {
    maskPatterns: opts?.maskPatterns ?? [...DEFAULT_MASK_PATTERNS],
    autoMaskInAudit: opts?.autoMaskInAudit ?? true,
  };
}

/**
 * Parse raw JSON data into an EnvSecurityConfig.
 * Handles both snake_case (from API/serialization) and camelCase keys.
 */
export function parseEnvSecurityConfig(data: Record<string, any>): EnvSecurityConfig {
  return {
    maskPatterns: data.mask_patterns ?? data.maskPatterns ?? [...DEFAULT_MASK_PATTERNS],
    autoMaskInAudit: data.auto_mask_in_audit ?? data.autoMaskInAudit ?? true,
  };
}

/**
 * Check if an environment variable key matches any of the sensitive patterns.
 * Uses fnmatch-style glob matching where `*` matches any sequence of characters.
 */
export function isSensitive(key: string, patterns: string[]): boolean {
  const upper = key.toUpperCase();
  for (const pattern of patterns) {
    if (globMatch(pattern.toUpperCase(), upper)) {
      return true;
    }
  }
  return false;
}

/**
 * Simple fnmatch-style glob matching.
 * Only supports `*` wildcard (matches any sequence of characters).
 */
function globMatch(pattern: string, text: string): boolean {
  const parts = pattern.split('*');
  if (parts.length === 1) {
    return pattern === text;
  }

  let pos = 0;

  // First part must match at the start
  if (parts[0] !== '') {
    if (!text.startsWith(parts[0])) return false;
    pos = parts[0].length;
  }

  // Last part must match at the end
  const lastPart = parts[parts.length - 1];
  if (lastPart !== '') {
    if (!text.endsWith(lastPart)) return false;
  }

  // Middle parts must appear in order
  for (let i = 1; i < parts.length - 1; i++) {
    const idx = text.indexOf(parts[i], pos);
    if (idx === -1) return false;
    pos = idx + parts[i].length;
  }

  // Make sure we haven't gone past where the last part starts
  if (lastPart !== '') {
    const lastStart = text.length - lastPart.length;
    if (pos > lastStart) return false;
  }

  return true;
}

/** A secure environment variable. */
export interface SecureEnvVar {
  key: string;
  value: string;
  secret: boolean;
}
