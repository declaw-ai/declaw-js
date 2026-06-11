import { InvalidArgumentError } from '../errors.js';

/** Types of PII that can be detected. */
export enum PIIType {
  SSN = 'ssn',
  CreditCard = 'credit_card',
  Email = 'email',
  Phone = 'phone',
  PersonName = 'person_name',
  APIKey = 'api_key',
  Address = 'address',
  IPAddress = 'ip_address',
}

/** Actions to take when PII is detected. */
export enum RedactionAction {
  Redact = 'redact',
  Block = 'block',
  LogOnly = 'log_only',
}

const VALID_PII_TYPES = new Set(Object.values(PIIType));
const VALID_REDACTION_ACTIONS = new Set(Object.values(RedactionAction));

/** Configuration for PII detection and redaction. */
export interface PIIConfig {
  enabled: boolean;
  types: string[];
  action: string;
  rehydrateResponse: boolean;
  /** Optional domain allowlist; when undefined, applies to all domains. */
  domains?: string[];
}

/**
 * Create a PIIConfig with defaults and validation.
 */
export function createPIIConfig(opts?: Partial<PIIConfig>): PIIConfig {
  const config: PIIConfig = {
    enabled: opts?.enabled ?? false,
    types: opts?.types ?? Object.values(PIIType),
    action: opts?.action ?? RedactionAction.Redact,
    rehydrateResponse: opts?.rehydrateResponse ?? true,
    domains: opts?.domains,
  };

  for (const t of config.types) {
    if (!VALID_PII_TYPES.has(t as PIIType)) {
      throw new InvalidArgumentError(`Invalid PII type: "${t}". Valid types: ${[...VALID_PII_TYPES].join(', ')}`);
    }
  }

  if (!VALID_REDACTION_ACTIONS.has(config.action as RedactionAction)) {
    throw new InvalidArgumentError(
      `Invalid redaction action: "${config.action}". Valid actions: ${[...VALID_REDACTION_ACTIONS].join(', ')}`,
    );
  }

  return config;
}

/** Parse raw JSON data into PIIConfig. */
export function parsePIIConfig(data: Record<string, any>): PIIConfig {
  return {
    enabled: data.enabled ?? false,
    types: data.types ?? Object.values(PIIType),
    action: data.action ?? RedactionAction.Redact,
    rehydrateResponse: data.rehydrate_response ?? data.rehydrateResponse ?? true,
    domains: data.domains,
  };
}
