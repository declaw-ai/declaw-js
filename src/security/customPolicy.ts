/**
 * Custom OPA policy configuration for per-sandbox policy overrides.
 */

export interface CustomPolicyConfig {
  /** Enable custom policy evaluation for this sandbox. */
  enabled: boolean;

  /**
   * Customer-supplied Rego code appended to platform defaults.
   *
   * Example:
   *   deny_command contains msg if {
   *     input.action.command in {"rm", "dd"}
   *     msg := "dangerous command blocked"
   *   }
   */
  inlineRego?: string;

  /**
   * Additional independent Rego modules, each with its own `package` declaration.
   *
   * Use when your policy spans multiple packages (e.g. a `cmd` package and a
   * `network` package) that need to cross-reference each other. Each entry is
   * compiled as a separate OPA module alongside `inlineRego`.
   */
  inlineModules?: string[];

  /** Future: reference to a bundled policy (URL, policy ID, version hash). */
  policyRef?: string;

  /**
   * When the evaluator is unreachable, deny (true) or allow (false).
   *
   * Fail-closed (defaultDeny=true) is safer for security gates.
   * Fail-open (defaultDeny=false) is acceptable for advisory scanners.
   */
  defaultDeny?: boolean;
}

/** Create a CustomPolicyConfig with defaults. */
export function createCustomPolicyConfig(
  opts?: Partial<CustomPolicyConfig>
): CustomPolicyConfig {
  return {
    enabled: opts?.enabled ?? false,
    inlineRego: opts?.inlineRego,
    inlineModules: opts?.inlineModules,
    policyRef: opts?.policyRef,
    defaultDeny: opts?.defaultDeny ?? false,
  };
}

/** Parse raw JSON data into a CustomPolicyConfig. */
export function parseCustomPolicyConfig(
  data: Record<string, any>
): CustomPolicyConfig {
  return {
    enabled: data.enabled ?? false,
    inlineRego: data.inline_rego ?? data.inlineRego,
    inlineModules: data.inline_modules ?? data.inlineModules,
    policyRef: data.policy_ref ?? data.policyRef,
    defaultDeny: data.default_deny ?? data.defaultDeny ?? false,
  };
}

/** Convert CustomPolicyConfig to JSON. */
export function customPolicyConfigToJSON(config: CustomPolicyConfig): Record<string, any> {
  return {
    enabled: config.enabled,
    inline_rego: config.inlineRego,
    inline_modules: config.inlineModules,
    policy_ref: config.policyRef,
    default_deny: config.defaultDeny,
  };
}
