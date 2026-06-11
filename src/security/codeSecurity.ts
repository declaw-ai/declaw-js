import { InvalidArgumentError } from '../errors.js';

const VALID_ACTIONS = new Set(['block', 'log_only']);

/** Configuration for code security scanning. */
export interface CodeSecurityConfig {
  enabled: boolean;
  threshold: number;
  /** Optional languages to exclude from detection; undefined = scan all languages. */
  excludedLanguages?: string[];
  action: 'block' | 'log_only';
  /** Optional domain allowlist; undefined = all domains. */
  domains?: string[];
}

/**
 * Create a CodeSecurityConfig with defaults and validation.
 */
export function createCodeSecurityConfig(opts?: Partial<CodeSecurityConfig>): CodeSecurityConfig {
  const config: CodeSecurityConfig = {
    enabled: opts?.enabled ?? false,
    threshold: opts?.threshold ?? 0.6,
    excludedLanguages: opts?.excludedLanguages,
    action: opts?.action ?? 'log_only',
    domains: opts?.domains,
  };

  if (!Number.isFinite(config.threshold) || config.threshold < 0 || config.threshold > 1) {
    throw new InvalidArgumentError(
      `Invalid code security threshold: ${config.threshold}. Must be a finite number between 0 and 1.`,
    );
  }

  if (!VALID_ACTIONS.has(config.action)) {
    throw new InvalidArgumentError(
      `Invalid code security action: "${config.action}". Valid actions: ${[...VALID_ACTIONS].join(', ')}`,
    );
  }

  return config;
}

/** Parse raw JSON data into CodeSecurityConfig. */
export function parseCodeSecurityConfig(data: Record<string, unknown>): CodeSecurityConfig {
  return {
    enabled: (data.enabled as boolean) ?? false,
    threshold: (data.threshold as number) ?? 0.6,
    excludedLanguages:
      (data.excluded_languages as string[] | undefined) ??
      (data.excludedLanguages as string[] | undefined),
    action: (data.action as 'block' | 'log_only') ?? 'log_only',
    domains: data.domains as string[] | undefined,
  };
}

/** Serialize a CodeSecurityConfig to a JSON-friendly object. */
export function codeSecurityConfigToJSON(config: CodeSecurityConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {
    enabled: config.enabled,
    threshold: config.threshold,
    action: config.action,
  };
  if (config.excludedLanguages !== undefined) {
    result.excluded_languages = config.excludedLanguages;
  }
  if (config.domains !== undefined) {
    result.domains = config.domains;
  }
  return result;
}
