/**
 * Configuration for connecting to the Declaw API.
 */
export interface ConnectionConfigOptions {
  /** API key for authentication. Defaults to DECLAW_API_KEY env var. */
  apiKey?: string;
  /** Domain of the Declaw API. Defaults to DECLAW_DOMAIN env var or 'api.declaw.ai'. */
  domain?: string;
  /** Port of the Declaw API. Defaults to 443. */
  port?: number;
  /** Full API URL override. If set, domain/port/scheme are ignored. */
  apiUrl?: string;
  /** Request timeout in milliseconds. */
  requestTimeout?: number;
}

/**
 * Holds connection configuration for the Declaw API.
 */
export class ConnectionConfig {
  readonly apiKey: string;
  readonly domain: string;
  readonly port: number;
  readonly apiUrl: string;
  readonly requestTimeout?: number;

  constructor(opts?: ConnectionConfigOptions) {
    this.apiKey = opts?.apiKey ?? process.env.DECLAW_API_KEY ?? '';
    this.requestTimeout = opts?.requestTimeout;

    // Parse "host:port" from domain, matching Python SDK behavior.
    // e.g. domain="myhost.example.com:8080" → domain="myhost.example.com", port=8080
    let rawDomain = opts?.domain ?? process.env.DECLAW_DOMAIN ?? 'api.declaw.ai';
    let rawPort = opts?.port ?? 443;

    if (opts?.port === undefined && rawDomain.includes(':')) {
      const lastColon = rawDomain.lastIndexOf(':');
      const maybPort = parseInt(rawDomain.substring(lastColon + 1), 10);
      if (!isNaN(maybPort)) {
        rawPort = maybPort;
        rawDomain = rawDomain.substring(0, lastColon);
      }
    }

    this.domain = rawDomain;
    this.port = rawPort;

    if (opts?.apiUrl) {
      this.apiUrl = opts.apiUrl;
    } else {
      const scheme = this.port === 443 ? 'https' : 'http';
      if (this.port === 443 || this.port === 80) {
        this.apiUrl = `${scheme}://${this.domain}`;
      } else {
        this.apiUrl = `${scheme}://${this.domain}:${this.port}`;
      }
    }
  }
}
