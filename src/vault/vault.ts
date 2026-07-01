import { ConnectionConfig } from '../connectionConfig.js';
import { getSharedClient } from '../api/client.js';
import type {
  VaultScope,
  VaultSecret,
  VaultPreset,
} from './models.js';
import {
  parseVaultSecret,
  parseVaultPreset,
  vaultScopeToJSON,
} from './models.js';

/** Shared per-call options for Vault methods. */
export interface VaultRequestOpts {
  /** API key override. */
  apiKey?: string;
  /** Domain override. */
  domain?: string;
  /** Full API URL override. */
  apiUrl?: string;
  /** Per-request timeout in milliseconds. */
  requestTimeout?: number;
}

/**
 * Input for creating a vault secret. The team and environment are resolved
 * automatically (a single "default" team + "prod" environment per account) —
 * those concepts are not part of the public API.
 */
export interface CreateSecretInput {
  /** The secret value (required; never returned after create). */
  value: string;
  /** Secret name. Defaults to provider when omitted. */
  name?: string;
  /** Optional preset provider key, e.g. "openai". Supplies scopes automatically. */
  provider?: string;
  /** Explicit injection scopes. Required unless provider is set. */
  scopes?: VaultScope[];
  /** Rotation policy in days. Omitted when 0 or not set. */
  rotationIntervalDays?: number;
}

// ---------------------------------------------------------------------------
// Internal tenancy constants — team/environment are not part of the public API.
// Every secret lives under a "default" team + "prod" environment, provisioned
// on demand. Callers address secrets by name only.
// ---------------------------------------------------------------------------

const DEFAULT_TEAM_NAME = 'default';
const DEFAULT_ENV_NAME = 'prod';

// Per (apiUrl + apiKey) cache of the resolved default team id. Populated on
// first use so the resolution (GET /teams, occasionally a POST) happens once
// per account per process.
const defaultTeamCache = new Map<string, string>();

function cacheKey(config: ConnectionConfig): string {
  return `${config.apiUrl}\x00${config.apiKey}`;
}

interface TeamRec {
  team_id: string;
  name: string;
  created_at: string;
}

interface EnvRec {
  env_id: string;
  name: string;
}

/**
 * Returns the "default" team id for the account. When create is true the team
 * is provisioned if absent. Among duplicate "default" teams (the backend
 * doesn't enforce name-uniqueness) the oldest by created_at is chosen so all
 * clients converge. Result is cached per (apiUrl, apiKey).
 */
export async function resolveDefaultTeamId(
  config: ConnectionConfig,
  create: boolean,
  timeout?: number,
): Promise<string | null> {
  const key = cacheKey(config);
  const cached = defaultTeamCache.get(key);
  if (cached !== undefined) return cached;

  const client = getSharedClient(config);
  const resp = (await client.get('/teams', { timeout })) as Record<string, unknown>;
  const rows = (resp.teams as TeamRec[] | undefined) ?? [];

  let best: TeamRec | null = null;
  for (const t of rows) {
    if (t.name === DEFAULT_TEAM_NAME) {
      if (best === null || t.created_at < best.created_at) {
        best = t;
      }
    }
  }

  if (best !== null) {
    defaultTeamCache.set(key, best.team_id);
    return best.team_id;
  }

  if (!create) return null;

  const created = (await client.post('/teams', {
    json: { name: DEFAULT_TEAM_NAME },
    timeout,
  })) as TeamRec;
  defaultTeamCache.set(key, created.team_id);
  return created.team_id;
}

/**
 * Ensures the "prod" environment exists on the given team. A conflict from a
 * concurrent create is treated as success.
 */
async function ensureDefaultEnv(
  config: ConnectionConfig,
  teamId: string,
  timeout?: number,
): Promise<void> {
  const client = getSharedClient(config);
  const resp = (await client.get(
    `/teams/${encodeURIComponent(teamId)}/environments`,
    { timeout },
  )) as Record<string, unknown>;
  const rows = (resp.environments as EnvRec[] | undefined) ?? [];

  if (rows.some((e) => e.name === DEFAULT_ENV_NAME)) return;

  try {
    await client.post(`/teams/${encodeURIComponent(teamId)}/environments`, {
      json: { name: DEFAULT_ENV_NAME },
      timeout,
    });
  } catch {
    // A concurrent creator may have won; re-check before propagating.
    const resp2 = (await client.get(
      `/teams/${encodeURIComponent(teamId)}/environments`,
      { timeout },
    )) as Record<string, unknown>;
    const rows2 = (resp2.environments as EnvRec[] | undefined) ?? [];
    if (rows2.some((e) => e.name === DEFAULT_ENV_NAME)) return;
    throw new Error(`Failed to ensure default environment "${DEFAULT_ENV_NAME}" on team ${teamId}`);
  }
}

/**
 * Expands bare secret names in a vault_refs map to full
 * vault://<teamId>/prod/<name> URIs the backend understands. Values already
 * in vault:// form are passed through unchanged. Resolves the default team
 * once (create=false — callers that need the team to exist use createSecret
 * first).
 */
export async function expandVaultRefs(
  config: ConnectionConfig,
  refs: Record<string, string>,
  timeout?: number,
): Promise<Record<string, string>> {
  if (Object.keys(refs).length === 0) return refs;

  const needsTeam = Object.values(refs).some((v) => !v.startsWith('vault://'));
  if (!needsTeam) return refs;

  const teamId = await resolveDefaultTeamId(config, false, timeout);
  if (teamId === null) {
    throw new Error('vault_refs given but no vault secrets exist for this account');
  }

  const out: Record<string, string> = {};
  for (const [envVar, ref] of Object.entries(refs)) {
    out[envVar] = ref.startsWith('vault://')
      ? ref
      : `vault://${teamId}/${DEFAULT_ENV_NAME}/${ref}`;
  }
  return out;
}

function buildConfig(opts?: VaultRequestOpts): ConnectionConfig {
  return new ConnectionConfig({
    apiKey: opts?.apiKey,
    domain: opts?.domain,
    apiUrl: opts?.apiUrl,
    requestTimeout: opts?.requestTimeout,
  });
}

/**
 * Vault secret management. All methods are static and derive their connection
 * from the trailing VaultRequestOpts argument (or env vars when opts is
 * omitted). The team/environment concepts are handled automatically — every
 * secret lives under a single auto-provisioned "default" team and "prod"
 * environment. Secrets are addressed by name only.
 */
export class Vault {
  // -------------------------------------------------------------------------
  // Secrets
  // -------------------------------------------------------------------------

  /**
   * Store a secret's value (server-side, in OpenBao) plus its injection
   * scopes, under the auto-provisioned default team + "prod" environment.
   * Returns metadata only — the value is never echoed.
   *
   * POST /teams/{teamId}/vault/secrets
   */
  static async createSecret(
    input: CreateSecretInput,
    opts?: VaultRequestOpts,
  ): Promise<VaultSecret> {
    const config = buildConfig(opts);
    const teamId = await resolveDefaultTeamId(config, true, opts?.requestTimeout);
    if (teamId === null) throw new Error('Failed to resolve or create default team');
    await ensureDefaultEnv(config, teamId, opts?.requestTimeout);

    const body: Record<string, unknown> = {
      environment: DEFAULT_ENV_NAME,
      value: input.value,
    };
    if (input.name) body.name = input.name;
    if (input.provider) body.provider = input.provider;
    if (input.scopes && input.scopes.length > 0) {
      body.scopes = input.scopes.map(vaultScopeToJSON);
    }
    if (input.rotationIntervalDays && input.rotationIntervalDays > 0) {
      body.rotation_interval_days = input.rotationIntervalDays;
    }

    const client = getSharedClient(config);
    const resp = (await client.post(
      `/teams/${encodeURIComponent(teamId)}/vault/secrets`,
      { json: body, timeout: opts?.requestTimeout },
    )) as Record<string, unknown>;
    return parseVaultSecret(resp);
  }

  /**
   * List secret metadata for the default team. Returns an empty array if no
   * default team has been provisioned yet.
   *
   * GET /teams/{teamId}/vault/secrets -> {secrets}
   */
  static async listSecrets(opts?: VaultRequestOpts): Promise<VaultSecret[]> {
    const config = buildConfig(opts);
    const teamId = await resolveDefaultTeamId(config, false, opts?.requestTimeout);
    if (teamId === null) return [];

    const client = getSharedClient(config);
    const resp = (await client.get(
      `/teams/${encodeURIComponent(teamId)}/vault/secrets`,
      { timeout: opts?.requestTimeout },
    )) as Record<string, unknown>;
    const rows = (resp.secrets as Record<string, unknown>[] | undefined) ?? [];
    return rows.map(parseVaultSecret);
  }

  /**
   * Replace a secret's value by name (server-side); scopes are unchanged.
   *
   * POST /teams/{teamId}/vault/secrets/{secretId}/rotate {value}
   */
  static async rotateSecret(
    name: string,
    value: string,
    opts?: VaultRequestOpts,
  ): Promise<void> {
    const config = buildConfig(opts);
    const teamId = await resolveDefaultTeamId(config, false, opts?.requestTimeout);
    if (teamId === null) throw new Error(`vault secret "${name}" not found`);

    const secretId = await Vault._resolveSecretId(config, teamId, name, opts?.requestTimeout);
    const client = getSharedClient(config);
    await client.post(
      `/teams/${encodeURIComponent(teamId)}/vault/secrets/${encodeURIComponent(secretId)}/rotate`,
      { json: { value }, timeout: opts?.requestTimeout },
    );
  }

  /**
   * Delete a secret by name — metadata and stored value.
   *
   * DELETE /teams/{teamId}/vault/secrets/{secretId}
   */
  static async deleteSecret(name: string, opts?: VaultRequestOpts): Promise<void> {
    const config = buildConfig(opts);
    const teamId = await resolveDefaultTeamId(config, false, opts?.requestTimeout);
    if (teamId === null) throw new Error(`vault secret "${name}" not found`);

    const secretId = await Vault._resolveSecretId(config, teamId, name, opts?.requestTimeout);
    const client = getSharedClient(config);
    await client.delete(
      `/teams/${encodeURIComponent(teamId)}/vault/secrets/${encodeURIComponent(secretId)}`,
      { timeout: opts?.requestTimeout },
    );
  }

  /**
   * Replace a secret's injection scopes by name; the value is unchanged. Use
   * this to change a secret's destination(s) or injection format in place
   * instead of delete + recreate. At least one scope is required.
   *
   * POST /teams/{teamId}/vault/secrets/{secretId}/scopes
   */
  static async updateScopes(
    name: string,
    scopes: VaultScope[],
    opts?: VaultRequestOpts,
  ): Promise<void> {
    if (!scopes || scopes.length === 0) {
      throw new Error('at least one scope is required');
    }
    const config = buildConfig(opts);
    const teamId = await resolveDefaultTeamId(config, false, opts?.requestTimeout);
    if (teamId === null) throw new Error(`vault secret "${name}" not found`);

    const secretId = await Vault._resolveSecretId(config, teamId, name, opts?.requestTimeout);
    const client = getSharedClient(config);
    await client.post(
      `/teams/${encodeURIComponent(teamId)}/vault/secrets/${encodeURIComponent(secretId)}/scopes`,
      { json: { scopes: scopes.map(vaultScopeToJSON) }, timeout: opts?.requestTimeout },
    );
  }

  // -------------------------------------------------------------------------
  // Presets
  // -------------------------------------------------------------------------

  /**
   * List built-in provider preset catalog (templates only, no secret material).
   *
   * GET /vault/presets -> {presets}
   */
  static async listPresets(opts?: VaultRequestOpts): Promise<VaultPreset[]> {
    const client = getSharedClient(buildConfig(opts));
    const resp = (await client.get('/vault/presets', {
      timeout: opts?.requestTimeout,
    })) as Record<string, unknown>;
    const rows = (resp.presets as Record<string, unknown>[] | undefined) ?? [];
    return rows.map(parseVaultPreset);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Maps a secret name to its id within the given team. */
  private static async _resolveSecretId(
    config: ConnectionConfig,
    teamId: string,
    name: string,
    timeout?: number,
  ): Promise<string> {
    const client = getSharedClient(config);
    const resp = (await client.get(
      `/teams/${encodeURIComponent(teamId)}/vault/secrets`,
      { timeout },
    )) as Record<string, unknown>;
    const rows = (resp.secrets as Record<string, unknown>[] | undefined) ?? [];
    for (const s of rows) {
      if (s.name === name) return String(s.secret_id ?? '');
    }
    throw new Error(`vault secret "${name}" not found`);
  }
}
