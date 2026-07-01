/**
 * One per-destination injection rule on a secret. The egress proxy matches
 * a request host against domainRegex and injects the secret as injectionType
 * (bearer|header|basic|query|sigv4|oidc|hmac|redis|postgres|mysql|smtp|mongodb).
 * The optional fields express a provider's full contract.
 */
export interface VaultScope {
  domainRegex: string;
  injectionType?: string;
  headerName?: string;
  valuePrefix?: string;
  basicUsername?: string;
  extraHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
}

/**
 * Metadata for a stored secret — never the value. The value lives
 * server-side (OpenBao) and is not returned after create.
 */
export interface VaultSecret {
  secretId: string;
  name: string;
  scopes?: VaultScope[];
  createdAt: string;
  updatedAt: string;
  rotatedAt?: string;
  rotationIntervalDays?: number;
  rotationDue?: boolean;
}

/**
 * A built-in provider template (domain + injection rules). Used so a caller
 * can store a credential by naming the provider and supplying only the value.
 * Carries no secret material.
 */
export interface VaultPreset {
  key: string;
  name: string;
  category: string;
  keyHint: string;
  docsUrl?: string;
  scopes: VaultScope[];
}

/** Parse a raw wire-format scope into a VaultScope. */
export function parseVaultScope(data: Record<string, unknown>): VaultScope {
  const scope: VaultScope = {
    domainRegex: String(data.domain_regex ?? ''),
  };
  if (data.injection_type !== undefined && data.injection_type !== null) {
    scope.injectionType = String(data.injection_type);
  }
  if (data.header_name !== undefined && data.header_name !== null) {
    scope.headerName = String(data.header_name);
  }
  if (data.value_prefix !== undefined && data.value_prefix !== null) {
    scope.valuePrefix = String(data.value_prefix);
  }
  if (data.basic_username !== undefined && data.basic_username !== null) {
    scope.basicUsername = String(data.basic_username);
  }
  if (data.extra_headers !== undefined && data.extra_headers !== null) {
    scope.extraHeaders = data.extra_headers as Record<string, string>;
  }
  if (data.query_params !== undefined && data.query_params !== null) {
    scope.queryParams = data.query_params as Record<string, string>;
  }
  return scope;
}

/** Parse a raw wire-format secret row into a VaultSecret. */
export function parseVaultSecret(data: Record<string, unknown>): VaultSecret {
  const secret: VaultSecret = {
    secretId: String(data.secret_id ?? ''),
    name: String(data.name ?? ''),
    createdAt: String(data.created_at ?? ''),
    updatedAt: String(data.updated_at ?? ''),
  };

  const rawScopes = data.scopes as Record<string, unknown>[] | null | undefined;
  if (rawScopes && rawScopes.length > 0) {
    secret.scopes = rawScopes.map(parseVaultScope);
  }

  if (data.rotated_at !== undefined && data.rotated_at !== null) {
    secret.rotatedAt = String(data.rotated_at);
  }
  if (data.rotation_interval_days !== undefined && data.rotation_interval_days !== null) {
    secret.rotationIntervalDays = Number(data.rotation_interval_days);
  }
  if (data.rotation_due !== undefined && data.rotation_due !== null) {
    secret.rotationDue = Boolean(data.rotation_due);
  }
  return secret;
}

/** Parse a raw wire-format preset into a VaultPreset. */
export function parseVaultPreset(data: Record<string, unknown>): VaultPreset {
  const rawScopes = (data.scopes as Record<string, unknown>[] | null | undefined) ?? [];
  const preset: VaultPreset = {
    key: String(data.key ?? ''),
    name: String(data.name ?? ''),
    category: String(data.category ?? ''),
    keyHint: String(data.key_hint ?? ''),
    scopes: rawScopes.map(parseVaultScope),
  };
  if (data.docs_url !== undefined && data.docs_url !== null) {
    preset.docsUrl = String(data.docs_url);
  }
  return preset;
}

/** Render a VaultScope in wire (snake_case) form for request bodies. */
export function vaultScopeToJSON(scope: VaultScope): Record<string, unknown> {
  const out: Record<string, unknown> = {
    domain_regex: scope.domainRegex,
  };
  if (scope.injectionType !== undefined) {
    out.injection_type = scope.injectionType;
  }
  if (scope.headerName !== undefined) {
    out.header_name = scope.headerName;
  }
  if (scope.valuePrefix !== undefined) {
    out.value_prefix = scope.valuePrefix;
  }
  if (scope.basicUsername !== undefined) {
    out.basic_username = scope.basicUsername;
  }
  if (scope.extraHeaders !== undefined) {
    out.extra_headers = scope.extraHeaders;
  }
  if (scope.queryParams !== undefined) {
    out.query_params = scope.queryParams;
  }
  return out;
}
