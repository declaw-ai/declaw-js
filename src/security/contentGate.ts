/** Configuration for the content.scan OPA gate (model/endpoint allowlist).
 *
 * Opts a sandbox into content-gate enforcement without requiring an ML
 * scanner.  {@link enabled} defaults to false (gate off).  {@link domains}
 * is an optional list of hosts to intercept; omit or leave undefined to
 * intercept none.
 */
export interface ContentGateConfig {
  enabled: boolean;
  /** Optional list of hosts to intercept. Undefined = none. */
  domains?: string[];
}

/**
 * Create a ContentGateConfig with defaults.
 */
export function createContentGateConfig(opts?: Partial<ContentGateConfig>): ContentGateConfig {
  return {
    enabled: opts?.enabled ?? false,
    domains: opts?.domains,
  };
}

/** Parse raw JSON data into ContentGateConfig. */
export function parseContentGateConfig(data: Record<string, unknown>): ContentGateConfig {
  return {
    enabled: (data.enabled as boolean) ?? false,
    domains: data.domains as string[] | undefined,
  };
}

/** Serialize a ContentGateConfig to a JSON-friendly object. */
export function contentGateConfigToJSON(config: ContentGateConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {
    enabled: config.enabled,
  };
  if (config.domains !== undefined) {
    result.domains = config.domains;
  }
  return result;
}
