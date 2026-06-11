import { InvalidArgumentError } from '../errors.js';

/** Sensitivity levels for injection detection. */
export enum InjectionSensitivity {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

/** Actions to take when injection is detected. */
export enum InjectionAction {
  Block = 'block',
  LogOnly = 'log_only',
}

const VALID_SENSITIVITIES = new Set(Object.values(InjectionSensitivity));
const VALID_ACTIONS = new Set(Object.values(InjectionAction));

/** Configuration for injection defense. */
export interface InjectionDefenseConfig {
  enabled: boolean;
  sensitivity: string;
  action: string;
  /** Detection threshold (0.0–1.0). Defaults to 0.8. */
  threshold: number;
  /** Optional domain allowlist; when undefined, applies to all domains. */
  domains?: string[];
}

/**
 * Create an InjectionDefenseConfig with defaults and validation.
 */
export function createInjectionDefenseConfig(
  opts?: Partial<InjectionDefenseConfig>,
): InjectionDefenseConfig {
  const config: InjectionDefenseConfig = {
    enabled: opts?.enabled ?? false,
    sensitivity: opts?.sensitivity ?? InjectionSensitivity.Medium,
    action: opts?.action ?? InjectionAction.LogOnly,
    threshold: opts?.threshold ?? 0.8,
    domains: opts?.domains,
  };

  if (!VALID_SENSITIVITIES.has(config.sensitivity as InjectionSensitivity)) {
    throw new InvalidArgumentError(
      `Invalid injection sensitivity: "${config.sensitivity}". Valid values: ${[...VALID_SENSITIVITIES].join(', ')}`,
    );
  }

  if (!VALID_ACTIONS.has(config.action as InjectionAction)) {
    throw new InvalidArgumentError(
      `Invalid injection action: "${config.action}". Valid actions: ${[...VALID_ACTIONS].join(', ')}`,
    );
  }

  if (!Number.isFinite(config.threshold) || config.threshold < 0 || config.threshold > 1) {
    throw new InvalidArgumentError(
      `Invalid injection threshold: ${config.threshold}. Must be a finite number between 0.0 and 1.0.`,
    );
  }

  return config;
}

/** Parse raw JSON data into InjectionDefenseConfig. */
export function parseInjectionDefenseConfig(data: Record<string, any>): InjectionDefenseConfig {
  return {
    enabled: data.enabled ?? false,
    sensitivity: data.sensitivity ?? InjectionSensitivity.Medium,
    action: data.action ?? InjectionAction.LogOnly,
    threshold: data.threshold ?? 0.8,
    domains: data.domains,
  };
}
