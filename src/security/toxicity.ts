import { InvalidArgumentError } from '../errors.js';

const VALID_ACTIONS = new Set(['block', 'log_only']);

/** Configuration for toxicity detection. */
export interface ToxicityConfig {
  enabled: boolean;
  threshold: number;
  action: 'block' | 'log_only';
  /** Optional domain allowlist; undefined = all domains. */
  domains?: string[];
}

/**
 * Create a ToxicityConfig with defaults and validation.
 */
export function createToxicityConfig(opts?: Partial<ToxicityConfig>): ToxicityConfig {
  const config: ToxicityConfig = {
    enabled: opts?.enabled ?? false,
    threshold: opts?.threshold ?? 0.9,
    action: opts?.action ?? 'block',
    domains: opts?.domains,
  };

  if (!Number.isFinite(config.threshold) || config.threshold < 0 || config.threshold > 1) {
    throw new InvalidArgumentError(
      `Invalid toxicity threshold: ${config.threshold}. Must be a finite number between 0 and 1.`,
    );
  }

  if (!VALID_ACTIONS.has(config.action)) {
    throw new InvalidArgumentError(
      `Invalid toxicity action: "${config.action}". Valid actions: ${[...VALID_ACTIONS].join(', ')}`,
    );
  }

  return config;
}

/** Parse raw JSON data into ToxicityConfig. */
export function parseToxicityConfig(data: Record<string, unknown>): ToxicityConfig {
  return {
    enabled: (data.enabled as boolean) ?? false,
    threshold: (data.threshold as number) ?? 0.9,
    action: (data.action as 'block' | 'log_only') ?? 'block',
    domains: data.domains as string[] | undefined,
  };
}

/** Serialize a ToxicityConfig to a JSON-friendly object. */
export function toxicityConfigToJSON(config: ToxicityConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {
    enabled: config.enabled,
    threshold: config.threshold,
    action: config.action,
  };
  if (config.domains !== undefined) {
    result.domains = config.domains;
  }
  return result;
}
