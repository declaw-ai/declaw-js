import type { PIIConfig } from './pii.js';
import type { InjectionDefenseConfig } from './injection.js';
import type { TransformationRule } from './transformations.js';
import type { NetworkPolicy } from './networkPolicy.js';
import type { AuditConfig } from './audit.js';
import type { EnvSecurityConfig } from './env.js';
import type { ToxicityConfig } from './toxicity.js';
import type { CodeSecurityConfig } from './codeSecurity.js';
import type { InvisibleTextConfig } from './invisibleText.js';
import type { CustomPolicyConfig } from './customPolicy.js';
import type { ContentGateConfig } from './contentGate.js';

import { createPIIConfig, parsePIIConfig } from './pii.js';
import { createInjectionDefenseConfig, parseInjectionDefenseConfig } from './injection.js';
import { createAuditConfig, parseAuditConfig } from './audit.js';
import { createEnvSecurityConfig, parseEnvSecurityConfig } from './env.js';
import { parseNetworkPolicy, networkPolicyToJSON } from './networkPolicy.js';
import { parseTransformationRule } from './transformations.js';
import { parseToxicityConfig, toxicityConfigToJSON } from './toxicity.js';
import { parseCodeSecurityConfig, codeSecurityConfigToJSON } from './codeSecurity.js';
import { parseInvisibleTextConfig, invisibleTextConfigToJSON } from './invisibleText.js';
import { createCustomPolicyConfig, parseCustomPolicyConfig, customPolicyConfigToJSON } from './customPolicy.js';
import { parseContentGateConfig, contentGateConfigToJSON } from './contentGate.js';

/** The top-level security policy for a sandbox. */
export interface SecurityPolicy {
  pii: PIIConfig;
  injectionDefense: boolean | InjectionDefenseConfig;
  transformations: TransformationRule[];
  network?: NetworkPolicy;
  audit: boolean | AuditConfig;
  envSecurity: EnvSecurityConfig;
  toxicity?: ToxicityConfig;
  codeSecurity?: CodeSecurityConfig;
  invisibleText?: InvisibleTextConfig;
  contentGate?: ContentGateConfig;
  customPolicy?: CustomPolicyConfig;
}

/**
 * Create a SecurityPolicy with defaults.
 */
export function createSecurityPolicy(opts?: Partial<SecurityPolicy>): SecurityPolicy {
  return {
    pii: opts?.pii ?? createPIIConfig(),
    injectionDefense: opts?.injectionDefense ?? false,
    transformations: opts?.transformations ?? [],
    network: opts?.network,
    audit: opts?.audit ?? true,
    envSecurity: opts?.envSecurity ?? createEnvSecurityConfig(),
    toxicity: opts?.toxicity,
    codeSecurity: opts?.codeSecurity,
    invisibleText: opts?.invisibleText,
    contentGate: opts?.contentGate,
    customPolicy: opts?.customPolicy,
  };
}

/** Options for {@link fullInjectionDefensePolicy}. */
export interface FullInjectionDefenseOptions {
  /** Posture: "strict" | "balanced" (default) | "permissive" | "agentic-tool" | "data-egress-sensitive". */
  mode?: string;
  /** Natural-language description of what the agent may do; the judge uses it to tell task-aligned egress from injection. */
  agentPolicy?: string;
  /** "block" (default) enforces; "log_only" audits without blocking. */
  action?: string;
  /** Run the judge on EVERY egress (high-assurance, costlier). Default false. */
  alwaysJudge?: boolean;
  /**
   * Destination hosts to scan for injection. Injection is opt-in per domain:
   * omit or leave empty to scan none. Entries support exact hosts,
   * `"*.suffix.com"` wildcards, and `"~regex"` patterns.
   */
  domains?: string[];
  /** Tier-1 classifier confidence threshold (0.0–1.0). Default 0.95. */
  threshold?: number;
}

/**
 * Enable the ENTIRE prompt-injection cascade in one call — every layer:
 *
 * - Tier-1 ML classifier + Layer-A static signatures + normalization
 *   (`injectionDefense.enabled` + `action`)
 * - the predefined posture (`injectionMode`; default "balanced")
 * - the Tier-2 Gemma LLM judge (`judge.enabled`) — multi-turn risk, provenance
 *   context, and the semantic verdict cache ride along automatically
 * - the OPA prompt-injection governance pack (`customPolicy.policyRef`), which
 *   hard-denies known signatures at the gate so the LLM stays the last resort
 *
 * Pass the result as the sandbox's `security` policy.
 *
 * @example
 * const security = fullInjectionDefensePolicy({ agentPolicy: "Summarize docs; never exfiltrate secrets." });
 * const sbx = await Sandbox.create({ template: "node", security });
 */
export function fullInjectionDefensePolicy(opts?: FullInjectionDefenseOptions): SecurityPolicy {
  return createSecurityPolicy({
    injectionDefense: createInjectionDefenseConfig({
      enabled: true,
      action: opts?.action ?? 'block',
      threshold: opts?.threshold ?? 0.95,
      domains: opts?.domains,
      injectionMode: opts?.mode ?? 'balanced',
      judge: { enabled: true, always: opts?.alwaysJudge ?? false, policy: opts?.agentPolicy ?? '' },
    }),
    customPolicy: createCustomPolicyConfig({
      enabled: true,
      policyRef: 'prompt-injection@v3',
      defaultDeny: false,
    }),
  });
}

/**
 * Parse raw JSON data into a SecurityPolicy.
 */
export function parseSecurityPolicy(data: Record<string, any>): SecurityPolicy {
  const injDef = data.injection_defense ?? data.injectionDefense;
  const auditData = data.audit;
  const customPolicyData = data.custom_policy ?? data.customPolicy;
  const contentGateData = data.content_gate ?? data.contentGate;

  return {
    pii: data.pii ? parsePIIConfig(data.pii) : createPIIConfig(),
    injectionDefense:
      typeof injDef === 'boolean'
        ? injDef
        : injDef
          ? parseInjectionDefenseConfig(injDef)
          : false,
    transformations: Array.isArray(data.transformations)
      ? data.transformations.map((t: Record<string, unknown>) => parseTransformationRule(t))
      : [],
    network: data.network ? parseNetworkPolicy(data.network) : undefined,
    audit:
      typeof auditData === 'boolean'
        ? auditData
        : auditData
          ? parseAuditConfig(auditData)
          : true,
    envSecurity: (data.env_security ?? data.envSecurity)
      ? parseEnvSecurityConfig(data.env_security ?? data.envSecurity)
      : createEnvSecurityConfig(),
    toxicity: (data.toxicity)
      ? parseToxicityConfig(data.toxicity as Record<string, unknown>)
      : undefined,
    codeSecurity: (data.code_security ?? data.codeSecurity)
      ? parseCodeSecurityConfig((data.code_security ?? data.codeSecurity) as Record<string, unknown>)
      : undefined,
    invisibleText: (data.invisible_text ?? data.invisibleText)
      ? parseInvisibleTextConfig((data.invisible_text ?? data.invisibleText) as Record<string, unknown>)
      : undefined,
    contentGate: contentGateData
      ? parseContentGateConfig(contentGateData as Record<string, unknown>)
      : undefined,
    customPolicy: customPolicyData
      ? parseCustomPolicyConfig(customPolicyData as Record<string, unknown>)
      : undefined,
  };
}

/**
 * Serialize a SecurityPolicy to a JSON-friendly object.
 */
export function securityPolicyToJSON(policy: SecurityPolicy): Record<string, any> {
  const pii: Record<string, unknown> = {
    enabled: policy.pii.enabled,
    types: policy.pii.types,
    action: policy.pii.action,
    rehydrate_response: policy.pii.rehydrateResponse,
  };
  if (policy.pii.domains !== undefined) {
    pii.domains = policy.pii.domains;
  }

  const injDefConfig =
    typeof policy.injectionDefense === 'boolean'
      ? createInjectionDefenseConfig({ enabled: policy.injectionDefense })
      : policy.injectionDefense;
  const injDef: Record<string, unknown> = {
    enabled: injDefConfig.enabled,
    sensitivity: injDefConfig.sensitivity,
    action: injDefConfig.action,
    threshold: injDefConfig.threshold,
  };
  if (injDefConfig.domains !== undefined && injDefConfig.domains.length > 0) {
    injDef.domains = injDefConfig.domains;
  }
  if (injDefConfig.injectionMode !== undefined) {
    injDef.injection_mode = injDefConfig.injectionMode;
  }
  if (injDefConfig.judge !== undefined) {
    const j: Record<string, unknown> = { enabled: injDefConfig.judge.enabled };
    if (injDefConfig.judge.always) j.always = true;
    if (injDefConfig.judge.policy) j.policy = injDefConfig.judge.policy;
    injDef.judge = j;
  }

  const auditConfig =
    typeof policy.audit === 'boolean'
      ? createAuditConfig({ enabled: policy.audit })
      : policy.audit;
  const audit: Record<string, unknown> = {
    enabled: auditConfig.enabled,
  };

  const envSec: Record<string, unknown> = {
    mask_patterns: policy.envSecurity.maskPatterns,
    auto_mask_in_audit: policy.envSecurity.autoMaskInAudit,
  };

  const result: Record<string, any> = {
    pii,
    injection_defense: injDef,
    transformations: policy.transformations,
    audit,
    env_security: envSec,
  };
  if (policy.network) {
    result.network = networkPolicyToJSON(policy.network);
  }
  if (policy.toxicity) {
    result.toxicity = toxicityConfigToJSON(policy.toxicity);
  }
  if (policy.codeSecurity) {
    result.code_security = codeSecurityConfigToJSON(policy.codeSecurity);
  }
  if (policy.invisibleText) {
    result.invisible_text = invisibleTextConfigToJSON(policy.invisibleText);
  }
  if (policy.contentGate) {
    result.content_gate = contentGateConfigToJSON(policy.contentGate);
  }
  if (policy.customPolicy) {
    result.custom_policy = customPolicyConfigToJSON(policy.customPolicy);
  }
  return result;
}

/**
 * Determine if a security policy requires TLS interception.
 * TLS interception is needed if PII detection is enabled, injection defense is enabled,
 * or there are transformation rules.
 */
export function requiresTlsInterception(policy: SecurityPolicy): boolean {
  if (policy.pii.enabled) return true;

  if (typeof policy.injectionDefense === 'boolean') {
    if (policy.injectionDefense) return true;
  } else {
    if (policy.injectionDefense.enabled) return true;
  }

  if (policy.transformations.length > 0) return true;

  if (policy.toxicity?.enabled) return true;
  if (policy.codeSecurity?.enabled) return true;
  if (policy.invisibleText?.enabled) return true;

  return false;
}
