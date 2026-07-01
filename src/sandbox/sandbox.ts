import { ConnectionConfig } from '../connectionConfig.js';
import { ApiClient, getSharedClient } from '../api/client.js';
import { InvalidArgumentError } from '../errors.js';
import { ALL_TRAFFIC } from './network.js';
import type { SandboxNetworkOpts } from './network.js';
import type { SecurityPolicy } from '../security/policy.js';
import { securityPolicyToJSON } from '../security/policy.js';
import type { SandboxInfo, SandboxMetrics, SandboxLifecycle, SnapshotInfo, Snapshot } from './models.js';
import { parseSandboxInfo, parseSandboxMetrics, parseSnapshotInfo, parseSnapshot } from './models.js';
import { Commands } from './commands/commands.js';
import { Filesystem } from './filesystem/filesystem.js';
import { Pty } from './pty/pty.js';
import { Stdio } from './stdio/stdio.js';
import type { VolumeAttachment } from '../volumes/models.js';
import { volumeAttachmentToJSON } from '../volumes/models.js';
import { expandVaultRefs } from '../vault/vault.js';

/** Options for creating a sandbox. */
export interface SandboxOpts {
  /** Template to use. Defaults to 'base'. */
  template?: string;
  /** Timeout in seconds. Defaults to 300. */
  timeout?: number;
  /** Metadata key-value pairs. */
  metadata?: Record<string, string>;
  /** Environment variables. */
  envs?: Record<string, string>;
  /** Vault secret references: ENV_NAME -> "vault://team/env/secret". The real
   *  value is resolved server+worker-side and injected at the egress proxy —
   *  the sandbox only ever sees a placeholder, never the secret value. */
  vaultRefs?: Record<string, string>;
  /** Whether to create a secure sandbox. Defaults to true. */
  secure?: boolean;
  /** If false, denies all outbound traffic. Defaults to true. */
  allowInternetAccess?: boolean;
  /** Fine-grained network configuration. Overrides allowInternetAccess. */
  network?: SandboxNetworkOpts;
  /** Security policy for the sandbox. */
  security?: SecurityPolicy;
  /** Lifecycle configuration. */
  lifecycle?: SandboxLifecycle;
  /** Volumes to attach at sandbox-boot time. Each {volumeId, mountPath}
   *  references a blob uploaded via `Volumes.create`; the orchestrator
   *  materializes its contents under `mountPath` before the first command
   *  is dispatched. */
  volumes?: VolumeAttachment[];
  /** API key override. */
  apiKey?: string;
  /** Domain override (supports "host:port" format, e.g. "myhost.example.com:8080"). */
  domain?: string;
  /** Full API URL override. If set, domain/port/scheme are ignored. */
  apiUrl?: string;
  /** Per-request timeout in milliseconds. */
  requestTimeout?: number;
}

/** Default template name. */
const DEFAULT_TEMPLATE = 'base';

/** Default sandbox timeout in seconds. */
const DEFAULT_TIMEOUT = 300;

/** Port conventionally used for MCP servers running inside a sandbox. */
const MCP_PORT = 50005;

const VALID_ID_RE = /^[a-zA-Z0-9_-]+$/;

/** Validate that an ID is safe for URL path interpolation. */
function assertValidId(id: string, label: string): void {
  if (!id || !VALID_ID_RE.test(id)) {
    throw new InvalidArgumentError(
      `Invalid ${label}: "${id}". Must be alphanumeric with hyphens/underscores only.`,
    );
  }
}

/**
 * A Declaw sandbox.
 *
 * Use `Sandbox.create()` to create a new sandbox, or `Sandbox.connect()` to
 * connect to an existing one. Do not instantiate directly.
 */
export class Sandbox {
  private readonly _sandboxId: string;
  private readonly _config: ConnectionConfig;
  private readonly _client: ApiClient;
  private readonly _envdAccessToken?: string;
  private readonly _sandboxDomain?: string;
  private readonly _trafficAccessToken?: string;
  private readonly _commands: Commands;
  private readonly _files: Filesystem;
  private readonly _pty: Pty;
  private readonly _stdio: Stdio;

  private constructor(
    sandboxId: string,
    config: ConnectionConfig,
    client: ApiClient,
    envdAccessToken?: string,
    sandboxDomain?: string,
    trafficAccessToken?: string,
  ) {
    this._sandboxId = sandboxId;
    this._config = config;
    this._client = client;
    this._envdAccessToken = envdAccessToken;
    this._sandboxDomain = sandboxDomain;
    this._trafficAccessToken = trafficAccessToken;
    this._commands = new Commands(sandboxId, client);
    this._files = new Filesystem(sandboxId, client);
    this._pty = new Pty(sandboxId, client);
    this._stdio = new Stdio(sandboxId, client);
  }

  /** The unique sandbox identifier. */
  get sandboxId(): string {
    return this._sandboxId;
  }

  /** The connection configuration used by this sandbox. */
  get config(): ConnectionConfig {
    return this._config;
  }

  /** Access token for the envd service inside the sandbox. */
  get envdAccessToken(): string | undefined {
    return this._envdAccessToken;
  }

  /** Domain where the sandbox is accessible. */
  get sandboxDomain(): string | undefined {
    return this._sandboxDomain;
  }

  /** Access token for traffic routing to the sandbox. */
  get trafficAccessToken(): string | undefined {
    return this._trafficAccessToken;
  }

  /** Commands sub-module for executing and managing commands. */
  get commands(): Commands {
    return this._commands;
  }

  /** Filesystem sub-module for reading and writing files. */
  get files(): Filesystem {
    return this._files;
  }

  /** PTY sub-module for pseudo-terminal sessions. */
  get pty(): Pty {
    return this._pty;
  }

  /** Stdio sub-module for interactive subprocess sessions with stdin pipe. */
  get stdio(): Stdio {
    return this._stdio;
  }

  /**
   * Base URL for this sandbox's namespace on the Declaw API.
   *
   * All per-sandbox operations (commands, files, file streaming, ports) live
   * under this prefix. Callers must attach an `X-API-Key` header with their
   * Declaw API key.
   */
  get envdApiUrl(): string {
    return `${this._config.apiUrl}/sandboxes/${this._sandboxId}`;
  }

  /**
   * Return the path-based URL that reverse-proxies to `port` inside the sandbox.
   *
   * Requires `allowPublicTraffic` to be enabled on the sandbox's network
   * config (the default). The returned URL is authenticated via the same
   * API key as all other sandbox operations.
   */
  getHost(port: number): string {
    return `${this.envdApiUrl}/ports/${port}`;
  }

  /**
   * Return the URL for an MCP server listening on port 50005 inside the sandbox.
   */
  getMcpUrl(): string {
    return `${this.getHost(MCP_PORT)}/mcp`;
  }

  /**
   * URL for a streaming GET of `path` out of the sandbox.
   *
   * Supports files up to 500 MiB. Callers must attach `X-API-Key`; the URL
   * is NOT safe to share with third parties because the API key is required
   * separately.
   */
  downloadUrl(path: string, user?: string): string {
    const params = new URLSearchParams({ path });
    if (user) params.set('username', user);
    return `${this.envdApiUrl}/files/raw?${params.toString()}`;
  }

  /**
   * URL that accepts a streaming PUT with a raw binary body to write `path`
   * into the sandbox.
   *
   * Supports files up to 500 MiB. Same auth note as {@link downloadUrl}.
   */
  uploadUrl(path: string, user?: string): string {
    const params = new URLSearchParams({ path });
    if (user) params.set('username', user);
    return `${this.envdApiUrl}/files/raw?${params.toString()}`;
  }

  /**
   * Create a new sandbox.
   *
   * @param opts - Sandbox creation options.
   * @returns A new Sandbox instance connected to the created sandbox.
   */
  static async create(opts?: SandboxOpts): Promise<Sandbox> {
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      apiUrl: opts?.apiUrl,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);

    const body: Record<string, unknown> = {
      template: opts?.template ?? DEFAULT_TEMPLATE,
      timeout: opts?.timeout ?? DEFAULT_TIMEOUT,
      secure: opts?.secure ?? true,
    };

    if (opts?.metadata) {
      body.metadata = opts.metadata;
    }
    if (opts?.envs) {
      body.envs = opts.envs;
    }
    if (opts?.vaultRefs) {
      body.vault_refs = await expandVaultRefs(config, opts.vaultRefs, opts.requestTimeout);
    }

    // Network: explicit opts take precedence over allowInternetAccess flag
    if (opts?.network) {
      body.network = networkOptsToJSON(opts.network);
    } else if (opts?.allowInternetAccess === false) {
      body.network = { deny_out: [ALL_TRAFFIC] };
    }

    if (opts?.security) {
      body.security = { policy_json: JSON.stringify(securityPolicyToJSON(opts.security)) };
      // Propagate security.network to top-level network field (matching Python SDK)
      if (opts.security.network && !body.network) {
        body.network = typeof opts.security.network === 'object' && 'allowOut' in opts.security.network
          ? networkOptsToJSON(opts.security.network as SandboxNetworkOpts)
          : opts.security.network;
      }
    }

    if (opts?.lifecycle) {
      body.lifecycle = lifecycleToJSON(opts.lifecycle);
    }

    if (opts?.volumes && opts.volumes.length > 0) {
      body.volumes = opts.volumes.map(volumeAttachmentToJSON);
    }

    const data = (await client.post('/sandboxes', {
      json: body,
      timeout: opts?.requestTimeout,
    })) as Record<string, unknown>;

    const sandboxId = data.sandbox_id as string;
    assertValidId(sandboxId, 'sandbox ID (from server)');

    return new Sandbox(
      sandboxId,
      config,
      client,
      data.envd_access_token as string | undefined,
      data.sandbox_domain as string | undefined,
      data.traffic_access_token as string | undefined,
    );
  }

  /**
   * Connect to an existing sandbox.
   *
   * @param sandboxId - The sandbox ID to connect to.
   * @param opts - Connection options.
   * @returns A Sandbox instance connected to the existing sandbox.
   */
  static async connect(
    sandboxId: string,
    opts?: { apiKey?: string; domain?: string; apiUrl?: string; requestTimeout?: number },
  ): Promise<Sandbox> {
    assertValidId(sandboxId, 'sandbox ID');
    const config = new ConnectionConfig({
    apiKey: opts?.apiKey,
    domain: opts?.domain,
    apiUrl: opts?.apiUrl,
    requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);

    const data = (await client.get(`/sandboxes/${sandboxId}`, {
      timeout: opts?.requestTimeout,
    })) as Record<string, unknown>;

    return new Sandbox(
      data.sandbox_id as string,
      config,
      client,
      data.envd_access_token as string | undefined,
      data.sandbox_domain as string | undefined,
      data.traffic_access_token as string | undefined,
    );
  }

  /**
   * List sandboxes.
   *
   * Creates a temporary ApiClient, fetches the list, and closes the client.
   *
   * @param opts - Listing options.
   * @returns An object with parsed sandbox info array and optional pagination token.
   */
  static async list(opts?: {
    query?: Record<string, string>;
    limit?: number;
    nextToken?: string;
    apiKey?: string;
    domain?: string;
    apiUrl?: string;
    requestTimeout?: number;
  }): Promise<{ sandboxes: SandboxInfo[]; nextToken?: string }> {
    const config = new ConnectionConfig({
    apiKey: opts?.apiKey,
    domain: opts?.domain,
    apiUrl: opts?.apiUrl,
    requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);

    const params: Record<string, string> = {};
    if (opts?.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        params[key] = value;
      }
    }
    if (opts?.limit !== undefined) {
      params.limit = String(opts.limit);
    }
    if (opts?.nextToken) {
      params.next_token = opts.nextToken;
    }

    const data = (await client.get('/sandboxes', {
      params,
      timeout: opts?.requestTimeout,
    })) as Record<string, unknown>;

    const rawSandboxes = (data.sandboxes ?? []) as Record<string, unknown>[];
    const sandboxes = rawSandboxes.map((s) =>
      parseSandboxInfo(s as Record<string, unknown>),
    );

    return {
      sandboxes,
      nextToken: (data.next_token as string) ?? undefined,
    };
  }

  /**
   * Kill this sandbox.
   *
   * Returns once the kill has been accepted by the server. The per-VM
   * teardown (firecracker shutdown + netns + iptables cleanup) runs in
   * the background. Pass `{ wait: true }` to block until the teardown
   * has fully completed.
   *
   * @param requestTimeout - Optional per-request timeout in milliseconds.
   * @returns True if the sandbox was killed (or queued); false if the
   *   server reported it was already dead.
   */
  async kill(requestTimeout?: number): Promise<boolean>;
  async kill(opts?: { requestTimeout?: number; wait?: boolean }): Promise<boolean>;
  async kill(arg?: number | { requestTimeout?: number; wait?: boolean }): Promise<boolean> {
    const opts = typeof arg === 'number' ? { requestTimeout: arg } : (arg ?? {});
    const wait = opts.wait === true;
    const path = wait
      ? `/sandboxes/${this._sandboxId}`
      : `/sandboxes/${this._sandboxId}?async=true`;
    const data = (await this._client.delete(path, {
      timeout: opts.requestTimeout,
    })) as Record<string, unknown>;
    if (!wait) {
      return (data.queued as boolean) ?? true;
    }
    return (data.killed as boolean) ?? false;
  }

  /**
   * Kill many sandboxes in a single request. Server fans out internally
   * with bounded concurrency, eliminating per-id round-trip overhead.
   *
   * @param ids - sandbox IDs to kill.
   * @param opts.wait - If true, wait for each VM's teardown to finish
   *   before returning. Default is false (server returns 202 once the
   *   request is queued).
   * @param opts.requestTimeout - Per-request timeout in milliseconds.
   * @returns Map of sandbox-id → outcome. Outcome is `{killed: true}`
   *   (wait=true), `{queued: true}` (default), or `{error: string}` if
   *   the server reported a per-id failure.
   */
  static async killMany(
    ids: string[],
    opts?: { wait?: boolean; requestTimeout?: number; config?: ConnectionConfig },
  ): Promise<Record<string, { killed?: boolean; queued?: boolean; error?: string }>> {
    if (!ids || ids.length === 0) return {};
    const config = opts?.config ?? new ConnectionConfig();
    const client = getSharedClient(config);
    const path = opts?.wait ? '/sandboxes/kill-many' : '/sandboxes/kill-many?async=true';
    const data = (await client.post(path, {
      json: { sandbox_ids: ids },
      timeout: opts?.requestTimeout,
    })) as { results?: Record<string, { killed?: boolean; queued?: boolean; error?: string }> };
    return data.results ?? {};
  }

  /**
   * Kill a sandbox by id without first connecting. Sends a single
   * `DELETE /sandboxes/:id?async=true` and skips the metadata fetch
   * `Sandbox.connect(id).kill()` would otherwise pay. Useful for bulk
   * cleanup paths that only have the id.
   *
   * @param sandboxId - the sandbox to kill.
   * @param opts.wait - if true, block until the server finishes the
   *   per-VM teardown. Default is false: server returns 202 once the
   *   kill is queued.
   * @param opts.requestTimeout - per-request timeout in milliseconds.
   * @param opts.config - override the default ConnectionConfig.
   * @returns true if the kill was accepted (default) or completed
   *   (wait=true); false if the server reported the sandbox was
   *   already dead.
   */
  static async kill(
    sandboxId: string,
    opts?: { wait?: boolean; requestTimeout?: number; config?: ConnectionConfig },
  ): Promise<boolean> {
    const config = opts?.config ?? new ConnectionConfig();
    const client = getSharedClient(config);
    const wait = opts?.wait === true;
    const path = wait
      ? `/sandboxes/${sandboxId}`
      : `/sandboxes/${sandboxId}?async=true`;
    const data = (await client.delete(path, {
      timeout: opts?.requestTimeout,
    })) as Record<string, unknown>;
    if (!wait) return (data.queued as boolean) ?? true;
    return (data.killed as boolean) ?? false;
  }

  /**
   * Check if this sandbox is currently running.
   *
   * @param requestTimeout - Optional per-request timeout in milliseconds.
   * @returns True if the sandbox is running.
   */
  async isRunning(requestTimeout?: number): Promise<boolean> {
    const data = (await this._client.get(`/sandboxes/${this._sandboxId}/status`, {
      timeout: requestTimeout,
    })) as Record<string, unknown>;
    return (data.is_running as boolean) ?? false;
  }

  /**
   * Set the timeout for this sandbox.
   *
   * @param timeout - New timeout in seconds.
   * @param requestTimeout - Optional per-request timeout in milliseconds.
   */
  async setTimeout(timeout: number, requestTimeout?: number): Promise<void> {
    await this._client.patch(`/sandboxes/${this._sandboxId}/timeout`, {
      json: { timeout },
      timeout: requestTimeout,
    });
  }

  /**
   * Get information about this sandbox.
   *
   * @param requestTimeout - Optional per-request timeout in milliseconds.
   * @returns Parsed sandbox information.
   */
  async getInfo(requestTimeout?: number): Promise<SandboxInfo> {
    const data = (await this._client.get(`/sandboxes/${this._sandboxId}`, {
      timeout: requestTimeout,
    })) as Record<string, unknown>;
    return parseSandboxInfo(data);
  }

  /**
   * Get metrics for this sandbox.
   *
   * @param opts - Optional start/end date range and request timeout.
   * @returns Array of parsed sandbox metrics.
   */
  async getMetrics(opts?: {
    start?: Date;
    end?: Date;
    requestTimeout?: number;
  }): Promise<SandboxMetrics[]> {
    const params: Record<string, string> = {};
    if (opts?.start) {
      params.start = opts.start.toISOString();
    }
    if (opts?.end) {
      params.end = opts.end.toISOString();
    }

    const data = (await this._client.get(`/sandboxes/${this._sandboxId}/metrics`, {
      params,
      timeout: opts?.requestTimeout,
    })) as Record<string, unknown>[] | null;

    return (data ?? []).map((m) => parseSandboxMetrics(m));
  }

  /**
   * Pause this sandbox.
   *
   * @param requestTimeout - Optional per-request timeout in milliseconds.
   */
  async pause(requestTimeout?: number): Promise<void> {
    await this._client.post(`/sandboxes/${this._sandboxId}/pause`, {
      timeout: requestTimeout,
    });
  }

  /**
   * Resume a paused sandbox.
   *
   * @param requestTimeout - Optional per-request timeout in milliseconds.
   */
  async resume(requestTimeout?: number): Promise<void> {
    await this._client.post(`/sandboxes/${this._sandboxId}/resume`, {
      timeout: requestTimeout,
    });
  }

  /**
   * Create a snapshot of this sandbox.
   *
   * @param requestTimeout - Optional per-request timeout in milliseconds.
   * @returns Parsed snapshot information.
   */
  async createSnapshot(requestTimeout?: number): Promise<SnapshotInfo> {
    const data = (await this._client.post(`/sandboxes/${this._sandboxId}/snapshot`, {
      timeout: requestTimeout,
    })) as Record<string, unknown>;
    return parseSnapshotInfo(data);
  }

  /**
   * Create a manual snapshot of this sandbox.
   *
   * Manual snapshots accumulate — every call creates a new persistent
   * checkpoint that survives sandbox.kill(). Use Sandbox.listSnapshots()
   * to retrieve them and Sandbox.restore(sandboxId, { snapshotId }) to fork from one.
   *
   * @param requestTimeout - Optional per-request timeout in milliseconds.
   * @returns Parsed Snapshot metadata including the snapshot_id.
   */
  async snapshot(requestTimeout?: number): Promise<Snapshot> {
    const data = (await this._client.post(`/sandboxes/${this._sandboxId}/snapshot`, {
      json: {},
      timeout: requestTimeout,
    })) as Record<string, unknown>;
    return parseSnapshot(data);
  }

  /**
   * List all snapshots (periodic + pause + manual) for this sandbox, newest first.
   *
   * @param requestTimeout - Optional per-request timeout in milliseconds.
   * @returns Array of Snapshot metadata objects.
   */
  async listSnapshots(requestTimeout?: number): Promise<Snapshot[]> {
    const data = (await this._client.get(`/sandboxes/${this._sandboxId}/snapshots`, {
      timeout: requestTimeout,
    })) as Record<string, unknown>;
    const raw = (data.snapshots ?? []) as Record<string, unknown>[];
    return raw.map((s) => parseSnapshot(s));
  }

  /**
   * Delete a single snapshot of this sandbox by ID.
   *
   * The snapshot's PG row and S3 blobs (mem / vmstate / overlay) are
   * removed. Idempotent: deleting an already-deleted snapshot resolves to
   * true without throwing.
   *
   * The pause snapshot of a currently-paused sandbox is protected — the
   * server returns 409 because deletion would break Resume. Resume or
   * kill the sandbox first.
   *
   * @param snapshotId - The snapshot to delete.
   * @param requestTimeout - Optional per-request timeout in milliseconds.
   * @returns True on success.
   */
  async deleteSnapshot(snapshotId: string, requestTimeout?: number): Promise<boolean> {
    await this._client.delete(`/sandboxes/${this._sandboxId}/snapshots/${snapshotId}`, {
      timeout: requestTimeout,
    });
    return true;
  }

  /**
   * Restore a sandbox from a snapshot. The restored instance may run on a
   * different worker node than the original sandbox.
   *
   * @param sandboxId - The sandbox to restore.
   * @param options.snapshotId - Optional snapshot to restore from. If omitted,
   *   sandbox-manager picks the most recent snapshot (pause > periodic > manual).
   * @param options.apiKey - Optional API key override.
   * @param options.domain - Optional domain override.
   * @param options.requestTimeout - Optional per-request timeout in milliseconds.
   * @returns A new Sandbox instance connected to the restored sandbox.
   */
  static async restore(
    sandboxId: string,
    options: { snapshotId?: string; apiKey?: string; domain?: string; apiUrl?: string; requestTimeout?: number } = {},
  ): Promise<Sandbox> {
    assertValidId(sandboxId, 'sandbox ID');
    const config = new ConnectionConfig({
      apiKey: options.apiKey,
      domain: options.domain,
      apiUrl: options.apiUrl,
      requestTimeout: options.requestTimeout,
    });
    const client = getSharedClient(config);

      const query = options.snapshotId ? `?snapshot_id=${encodeURIComponent(options.snapshotId)}` : '';
      await client.post(`/sandboxes/${sandboxId}/restore${query}`, {
        timeout: options.requestTimeout,
      });

      // Fetch current sandbox state so the returned Sandbox is fully populated.
      const data = (await client.get(`/sandboxes/${sandboxId}`, {
        timeout: options.requestTimeout,
      })) as Record<string, unknown>;

      return new Sandbox(
        data.sandbox_id as string,
        config,
        client,
        data.envd_access_token as string | undefined,
        data.sandbox_domain as string | undefined,
        data.traffic_access_token as string | undefined,
      );
  }

  /**
   * Historically closed the sandbox's HTTP client; since 1.1.1 the SDK
   * maintains a process-wide shared ApiClient (see `getSharedClient` in
   * api/client.ts) so per-sandbox close no longer tears the connection
   * pool down. Kept as a no-op for backwards compatibility — call
   * `resetSharedClients()` if you want to force a full teardown.
   */
  close(): void {
    // no-op
  }

  /**
   * Support `await using sandbox = await Sandbox.create(...)` for automatic cleanup.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }
}

/** Convert SandboxNetworkOpts to snake_case JSON for the API. */
function networkOptsToJSON(opts: SandboxNetworkOpts): Record<string, unknown> {
  const result: Record<string, unknown> = {
    allow_out: opts.allowOut,
    deny_out: opts.denyOut,
    allow_public_traffic: opts.allowPublicTraffic,
  };
  if (opts.maskRequestHost !== undefined) {
    result.mask_request_host = opts.maskRequestHost;
  }
  return result;
}

/** Convert SandboxLifecycle to snake_case JSON for the API. */
function lifecycleToJSON(lifecycle: SandboxLifecycle): Record<string, unknown> {
  return {
    on_timeout: lifecycle.onTimeout,
    auto_resume: lifecycle.autoResume,
  };
}
