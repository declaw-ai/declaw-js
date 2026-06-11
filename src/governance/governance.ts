import { ConnectionConfig } from '../connectionConfig.js';
import { getSharedClient } from '../api/client.js';
import { InvalidArgumentError } from '../errors.js';
import type { GovernancePack } from './models.js';
import { parseGovernancePack } from './models.js';

const VALID_PACK_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function assertValidPackName(name: string): void {
  if (!name || !VALID_PACK_NAME_RE.test(name)) {
    throw new InvalidArgumentError(
      `Invalid pack name: "${name}". Must be alphanumeric with hyphens/underscores only.`,
    );
  }
}

/** Shared per-call options for Governance methods. */
export interface GovernanceRequestOpts {
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
 * Governance pack discovery.
 *
 * Lists and retrieves governance packs exposed by the Declaw control plane.
 * The /governance/packs endpoint is public — no auth is required — but the
 * SDK's normal Authorization header is still sent when an API key is
 * configured (harmless and consistent with other list methods).
 */
export class Governance {
  /**
   * List all available governance packs.
   *
   * Sends GET /governance/packs and returns the `packs` array.
   */
  static async listPacks(opts?: GovernanceRequestOpts): Promise<GovernancePack[]> {
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      apiUrl: opts?.apiUrl,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);
    const resp = (await client.get('/governance/packs', {
      timeout: opts?.requestTimeout,
    })) as Record<string, unknown>;
    const rows = (resp.packs as Record<string, unknown>[] | undefined) ?? [];
    return rows.map(parseGovernancePack);
  }

  /**
   * Fetch a single governance pack by name.
   *
   * Sends GET /governance/packs/:name and returns the pack object.
   * Throws InvalidArgumentError if the name contains unsafe characters.
   */
  static async getPack(name: string, opts?: GovernanceRequestOpts): Promise<GovernancePack> {
    assertValidPackName(name);
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      apiUrl: opts?.apiUrl,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);
    const resp = (await client.get(`/governance/packs/${name}`, {
      timeout: opts?.requestTimeout,
    })) as Record<string, unknown>;
    return parseGovernancePack(resp);
  }
}
