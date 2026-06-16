import { ConnectionConfig } from '../connectionConfig.js';
import {
  SandboxError,
  TimeoutError,
  NotFoundError,
  AuthenticationError,
  InvalidArgumentError,
  NotEnoughSpaceError,
  ConflictError,
} from '../errors.js';

// ---------------------------------------------------------------------------
// undici dispatcher (Node only).
//
// Node's built-in fetch() is backed by undici, which defaults to 10
// connections per origin. When callers fan out many concurrent requests
// (e.g. `Promise.all` of many `Sandbox.create()` calls) that cap becomes
// a client-side serialization point.
//
// We lazily install a module-scope undici Agent with a larger pool and
// keep-alive tuned for the Declaw backend. On runtimes that don't ship
// undici (browsers, Cloudflare Workers, Deno), the dynamic import
// silently fails and we fall through to the platform's native fetch.
//
// Tuning knobs (env vars — defaults sized so common burst workloads
// "just work" without configuration):
//   DECLAW_SDK_CONNECTIONS=N            — TCP connection pool size (default 64)
//   DECLAW_SDK_MAX_CONCURRENT_STREAMS=N — H2 streams per connection (default 1000;
//                                          undici's hard-coded default is 100)
//   DECLAW_SDK_DISABLE_DISPATCHER=1     — opt out, use platform fetch
//
// Math: pool capacity = connections × streams.
// At defaults (64 × 1000 = 64,000) a single Node process handles up to
// 60 k+ concurrent Sandbox.create() calls with zero client-side queueing.
// The 64-connection pool keeps TCP setup overhead minimal on cold start
// (benchmark-faster than larger pools at typical burst-100 workloads),
// while the 1000-stream-per-connection ceiling stays well under the
// server's advertised SETTINGS_MAX_CONCURRENT_STREAMS=4096 so undici
// never has to back off on a single connection. For workloads above
// 64 k concurrent in-flight, raise DECLAW_SDK_CONNECTIONS (e.g. 100 →
// 100,000 cap). Memory cost is modest: idle pool state is ~15 MB; sockets
// close after keepAliveTimeout=30s if unused. Low-concurrency callers
// pay only for what they actually use — the pool is lazy (sockets are
// dialed on demand).
// ---------------------------------------------------------------------------
let _dispatcherPromise: Promise<unknown | undefined> | undefined;
// Synchronously-cached resolved dispatcher. Once the import settles we store
// the value here so the hot path skips `await getDispatcher()` entirely (an
// await of even a resolved promise costs a microtask yield, which compounds
// under burst fan-out). `undefined` is a valid resolved state (non-Node / opt
// out); the separate `_dispatcherResolved` flag distinguishes "resolved to
// undefined" from "not yet resolved".
let _resolvedDispatcher: unknown | undefined;
let _dispatcherResolved = false;

function getDispatcher(): Promise<unknown | undefined> {
  if (_dispatcherPromise) return _dispatcherPromise;
  _dispatcherPromise = (async () => {
    try {
      // Only Node exposes process.versions.node; everything else bails.
      if (typeof process === 'undefined' || !process.versions?.node) {
        return undefined;
      }
      // Respect opt-out for users who bring their own dispatcher.
      if (process.env.DECLAW_SDK_DISABLE_DISPATCHER) {
        return undefined;
      }
      const undici: any = await import('undici');
      const connOverride = parseInt(process.env.DECLAW_SDK_CONNECTIONS || '', 10);
      const connections = Number.isFinite(connOverride) && connOverride > 0 ? connOverride : 512;
      const streamsOverride = parseInt(process.env.DECLAW_SDK_MAX_CONCURRENT_STREAMS || '', 10);
      const maxConcurrentStreams =
        Number.isFinite(streamsOverride) && streamsOverride > 0 ? streamsOverride : 1000;
      return new undici.Agent({
        connections,
        // maxConcurrentStreams only matters on H2 connections. undici negotiates
        // down to whatever the server advertises in SETTINGS_MAX_CONCURRENT_STREAMS,
        // so setting a high value here is safe — it caps the client-side intent,
        // server still wins.
        maxConcurrentStreams,
        keepAliveTimeout: 30_000,
        keepAliveMaxTimeout: 60_000,
        // NOTE: do NOT set `pipelining` here. undici applies it to H2 sessions
        // too, where `pipelining: 1` caps each connection to ONE in-flight
        // stream — silently defeating the H2 multiplexing that allowH2 enables.
        // Omitted, H2 sessions default to unlimited concurrent streams (capped
        // by maxConcurrentStreams) and H1.1 fallback defaults to 1 (safe, no
        // head-of-line risk on non-idempotent POSTs).
        allowH2: true,
        connect: { keepAlive: true, keepAliveInitialDelay: 5_000 },
      });
    } catch {
      return undefined;
    }
  })();
  // Cache the resolved value synchronously so the hot path can skip the await.
  void _dispatcherPromise.then((d) => {
    _resolvedDispatcher = d;
    _dispatcherResolved = true;
  });
  return _dispatcherPromise;
}

// Eagerly kick off the undici import at module load instead of lazily on the
// first request. Without this, the first burst of concurrent creates all queue
// on the one unresolved `import('undici')` (~40-63ms cold). Firing it here moves
// that cost onto module init, so by the time the first create runs it's ready.
void getDispatcher();

/**
 * Options for individual API requests.
 */
export interface RequestOpts {
  /** JSON body to serialize and send. */
  json?: unknown;
  /** Query parameters to append to the URL. */
  params?: Record<string, string>;
  /** Additional headers to merge with defaults. */
  headers?: Record<string, string>;
  /** Per-request timeout in milliseconds. Overrides config.requestTimeout. */
  timeout?: number;
  /** Raw body (string or Uint8Array). If set, json is ignored. */
  body?: string | Uint8Array;
}

/** Map of HTTP status codes to error classes. */
const STATUS_ERROR_MAP: Record<number, new (message: string) => SandboxError> = {
  400: InvalidArgumentError,
  401: AuthenticationError,
  403: AuthenticationError,
  404: NotFoundError,
  408: TimeoutError,
  409: ConflictError,
  413: NotEnoughSpaceError,
  422: InvalidArgumentError,
  507: NotEnoughSpaceError,
};

/**
 * HTTP client for the Declaw API with Bearer auth, exponential backoff with jitter,
 * error mapping, and resource safety via AbortController.
 */
export class ApiClient {
  private readonly config: ConnectionConfig;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly abortController: AbortController;

  constructor(
    config?: ConnectionConfig,
    opts?: { maxRetries?: number; retryDelay?: number },
  ) {
    this.config = config ?? new ConnectionConfig();
    this.maxRetries = opts?.maxRetries ?? 3;
    // Retry backoff base (seconds). Only applies to 5xx/network retries (0ms on
    // the success path). 0.1s base → delay(0)=50-100ms vs the old 0.5s's
    // 250-500ms, cutting worst-case single-retry latency 5x. Override per-client
    // via opts.retryDelay; set 0 to disable backoff entirely.
    this.retryDelay = opts?.retryDelay ?? 0.1;
    this.abortController = new AbortController();
  }

  /** Send a GET request and return parsed JSON. */
  async get(path: string, opts?: RequestOpts): Promise<unknown> {
    return this.requestWithRetry('GET', path, opts);
  }

  /** Send a GET request and return the response body as raw bytes. */
  async getBytes(path: string, opts?: RequestOpts): Promise<Uint8Array> {
    const response = await this.requestWithRetry('GET', path, opts, true) as Response;
    const buf = await response.arrayBuffer();
    return new Uint8Array(buf);
  }

  /** Send a POST request and return parsed JSON. */
  async post(path: string, opts?: RequestOpts): Promise<unknown> {
    return this.requestWithRetry('POST', path, opts);
  }

  /** Send a PATCH request and return parsed JSON. */
  async patch(path: string, opts?: RequestOpts): Promise<unknown> {
    return this.requestWithRetry('PATCH', path, opts);
  }

  /** Send a DELETE request and return parsed JSON. */
  async delete(path: string, opts?: RequestOpts): Promise<unknown> {
    return this.requestWithRetry('DELETE', path, opts);
  }

  /** Send a PUT request and return parsed JSON. */
  async put(path: string, opts?: RequestOpts): Promise<unknown> {
    return this.requestWithRetry('PUT', path, opts);
  }

  /**
   * Send a POST request and return the raw Response for SSE streaming.
   * Does NOT parse the response body.
   */
  async stream(path: string, opts?: RequestOpts): Promise<Response> {
    return this.requestWithRetry('POST', path, opts, true) as Promise<Response>;
  }

  /**
   * Send a GET request and return the raw Response for SSE streaming.
   * Does NOT parse the response body. Used by PTY stream consumers.
   */
  async streamGet(path: string, opts?: RequestOpts): Promise<Response> {
    return this.requestWithRetry('GET', path, opts, true) as Promise<Response>;
  }

  /**
   * Abort all in-flight requests and release resources.
   *
   * Since 1.1.1 the SDK maintains a process-wide shared ApiClient cache
   * for hot class-method paths (Sandbox.create, Volumes.*, Template.*).
   * Calling `close()` on a shared instance aborts its AbortController,
   * which would cancel any concurrent in-flight call. Prefer
   * `resetSharedClients()` if you want to tear down every cached client.
   */
  close(): void {
    this.abortController.abort();
  }

  private buildUrl(path: string, params?: Record<string, string>): string {
    const base = this.config.apiUrl.replace(/\/$/, '');
    const url = new URL(`${base}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    if (extra) {
      Object.assign(headers, extra);
    }
    return headers;
  }

  private async requestWithRetry(
    method: string,
    path: string,
    opts?: RequestOpts,
    rawResponse?: boolean,
  ): Promise<unknown> {
    const url = this.buildUrl(path, opts?.params);
    const headers = this.buildHeaders(opts?.headers);

    let fetchBody: string | Uint8Array | undefined;
    if (opts?.body !== undefined) {
      fetchBody = opts.body;
    } else if (opts?.json !== undefined) {
      fetchBody = JSON.stringify(opts.json);
      headers['Content-Type'] = 'application/json';
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        // Compose abort signals: global close() + per-request timeout
        const signals: AbortSignal[] = [this.abortController.signal];
        const timeoutMs = opts?.timeout ?? this.config.requestTimeout;
        if (timeoutMs !== undefined) {
          signals.push(AbortSignal.timeout(timeoutMs));
        }
        const signal = signals.length === 1
          ? signals[0]
          : AbortSignal.any(signals);

        // Pull the undici dispatcher. Once resolved (eagerly at module load),
        // read it from the synchronous cache to avoid an await/microtask yield
        // on every request — only the very first call (pre-resolution) awaits.
        const dispatcher = _dispatcherResolved ? _resolvedDispatcher : await getDispatcher();
        const fetchOpts: any = {
          method,
          headers,
          body: fetchBody,
          signal,
        };
        if (dispatcher) fetchOpts.dispatcher = dispatcher;
        const response = await fetch(url, fetchOpts);

        // 5xx: retry if we have attempts left
        if (response.status >= 500 && attempt < this.maxRetries - 1) {
          await this.delay(attempt);
          continue;
        }

        // Non-success: map to error
        if (!response.ok) {
          throw await this.buildError(response);
        }

        // Success: return raw or parsed
        if (rawResponse) {
          return response;
        }
        return this.parseResponseBody(response);
      } catch (error) {
        // If it's already one of our mapped errors (4xx), don't retry
        if (error instanceof SandboxError) {
          throw error;
        }

        // If the client was closed, don't retry — fail immediately
        if (this.abortController.signal.aborted) {
          throw new SandboxError('Client has been closed');
        }

        lastError = error as Error;

        // Network error: retry if attempts left
        if (attempt < this.maxRetries - 1) {
          await this.delay(attempt);
          continue;
        }
      }
    }

    throw new SandboxError(
      `Request failed after ${this.maxRetries} retries: ${lastError?.message ?? 'unknown error'}`,
    );
  }

  private async buildError(response: Response): Promise<SandboxError> {
    let message: string;
    try {
      const body = await response.json() as Record<string, unknown>;
      const bodyMsg = body.message ?? body.error ?? response.statusText;
      message = `HTTP ${response.status}: ${bodyMsg}`;
    } catch {
      message = `HTTP ${response.status}: ${response.statusText}`;
    }

    const ErrorClass = STATUS_ERROR_MAP[response.status];
    if (ErrorClass) {
      return new ErrorClass(message);
    }
    return new SandboxError(message);
  }

  private async parseResponseBody(response: Response): Promise<unknown> {
    const contentLength = response.headers.get('content-length');
    if (response.status === 204 || contentLength === '0') {
      return null;
    }
    // NOTE: kept as text()+JSON.parse rather than response.json(). The /files
    // read endpoint returns RAW file contents (non-JSON), and callers expect
    // the raw string back. response.json() can't support that — it returns
    // null on non-JSON and has already consumed the single-read body stream, so
    // a text() fallback is impossible. The ~1-2ms saved isn't worth breaking
    // raw-body reads or depending on Content-Type sniffing.
    const text = await response.text();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /**
   * Exponential backoff with jitter: delay * 2^attempt * (0.5 + random * 0.5)
   */
  private async delay(attempt: number): Promise<void> {
    if (this.retryDelay <= 0) return;
    const base = this.retryDelay * Math.pow(2, attempt);
    const jitter = 0.5 + Math.random() * 0.5;
    const ms = base * jitter * 1000; // retryDelay is in seconds
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ---------------------------------------------------------------------------
// Process-wide ApiClient cache.
//
// Under Node, we also install a module-level high-concurrency undici
// dispatcher (see getDispatcher() above) so burst workloads fan out
// without hitting undici's default 10-connection-per-origin cap. The
// shared ApiClient amortizes AbortController creation across class-method
// calls and keeps caller-level semantics symmetric with the Python SDK's
// get_shared_client().
// ---------------------------------------------------------------------------

const _sharedClients = new Map<string, ApiClient>();

function sharedKey(config: ConnectionConfig): string {
  return [config.apiKey ?? '', config.apiUrl, config.requestTimeout ?? ''].join('|');
}

export function getSharedClient(config: ConnectionConfig): ApiClient {
  const key = sharedKey(config);
  let client = _sharedClients.get(key);
  if (!client) {
    client = new ApiClient(config);
    _sharedClients.set(key, client);
  }
  return client;
}

export function resetSharedClients(): void {
  for (const client of _sharedClients.values()) {
    try {
      client.close();
    } catch {
      /* noop */
    }
  }
  _sharedClients.clear();
}
