import { InvalidArgumentError } from '../errors.js';

const VALID_ACTIONS = new Set(['block', 'strip', 'log_only']);

/** Configuration for invisible text detection. */
export interface InvisibleTextConfig {
  enabled: boolean;
  action: 'block' | 'strip' | 'log_only';
  /** Optional domain allowlist; undefined = all domains. */
  domains?: string[];
}

/**
 * Create an InvisibleTextConfig with defaults and validation.
 */
export function createInvisibleTextConfig(
  opts?: Partial<InvisibleTextConfig>,
): InvisibleTextConfig {
  const config: InvisibleTextConfig = {
    enabled: opts?.enabled ?? false,
    action: opts?.action ?? 'strip',
    domains: opts?.domains,
  };

  if (!VALID_ACTIONS.has(config.action)) {
    throw new InvalidArgumentError(
      `Invalid invisible text action: "${config.action}". Valid actions: ${[...VALID_ACTIONS].join(', ')}`,
    );
  }

  return config;
}

/** Parse raw JSON data into InvisibleTextConfig. */
export function parseInvisibleTextConfig(data: Record<string, unknown>): InvisibleTextConfig {
  return {
    enabled: (data.enabled as boolean) ?? false,
    action: (data.action as 'block' | 'strip' | 'log_only') ?? 'strip',
    domains: data.domains as string[] | undefined,
  };
}

/** Serialize an InvisibleTextConfig to a JSON-friendly object. */
export function invisibleTextConfigToJSON(config: InvisibleTextConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {
    enabled: config.enabled,
    action: config.action,
  };
  if (config.domains !== undefined) {
    result.domains = config.domains;
  }
  return result;
}
