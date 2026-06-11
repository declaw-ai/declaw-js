import { ConnectionConfig } from '../connectionConfig.js';
import { getSharedClient } from '../api/client.js';
import { InvalidArgumentError } from '../errors.js';
import type { TemplateBase } from './models.js';
import type { BuildInfo, TemplateBuildStatus } from './models.js';
import { parseBuildInfo, parseTemplateBuildStatus } from './models.js';

const VALID_BUILD_ID_RE = /^[a-zA-Z0-9_-]+$/;

/** Validate that a build ID is safe for URL path interpolation. */
function assertValidBuildId(buildId: string): void {
  if (!buildId || !VALID_BUILD_ID_RE.test(buildId)) {
    throw new InvalidArgumentError(
      `Invalid build ID: "${buildId}". Must be alphanumeric with hyphens/underscores only.`,
    );
  }
}

/** Options for Template.build() and Template.buildInBackground(). */
export interface TemplateBuildOpts {
  /** Number of CPUs for the build. */
  cpuCount?: number;
  /** Memory in MB for the build. */
  memoryMb?: number;
  /** Disk size in MB for the build (128–102400). */
  diskMb?: number;
  /** Callback invoked for each build log entry. */
  onBuildLogs?: (log: string) => void;
  /** API key override. */
  apiKey?: string;
  /** Domain override. */
  domain?: string;
  /** Per-request timeout in milliseconds. */
  requestTimeout?: number;
}

/** Options for Template.getBuildStatus(). */
export interface GetBuildStatusOpts {
  /** API key override. */
  apiKey?: string;
  /** Domain override. */
  domain?: string;
  /** Per-request timeout in milliseconds. */
  requestTimeout?: number;
}

/**
 * Template management.
 *
 * All methods are static and create their own temporary ApiClient,
 * ensuring the client is always closed via try/finally (fixing Python SDK's client leak).
 */
export class Template {
  /**
   * Build a template and wait for completion.
   *
   * Sends POST /templates/build with the template definition.
   * Invokes onBuildLogs for each log entry in the response.
   */
  static async build(
    template: TemplateBase,
    alias: string,
    opts?: TemplateBuildOpts,
  ): Promise<BuildInfo> {
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);

    const body: Record<string, unknown> = {
      template: template.toJSON(),
      alias,
    };

    if (opts?.cpuCount !== undefined) {
      body.cpu_count = opts.cpuCount;
    }
    if (opts?.memoryMb !== undefined) {
      body.memory_mb = opts.memoryMb;
    }
    if (opts?.diskMb !== undefined) {
      body.disk_mb = opts.diskMb;
    }

    const data = await client.post('/templates/build', {
      json: body,
      timeout: opts?.requestTimeout,
    });

    const response = data as Record<string, unknown>;
    const result = parseBuildInfo(response);

    // Invoke log callback if provided
    if (opts?.onBuildLogs && Array.isArray(response.logs)) {
      for (const log of response.logs as string[]) {
        opts.onBuildLogs(log);
      }
    }

    return result;
  }

  /**
   * Start a template build in the background.
   *
   * Sends POST /templates/build with `background: true`.
   */
  static async buildInBackground(
    template: TemplateBase,
    alias: string,
    opts?: Omit<TemplateBuildOpts, 'onBuildLogs'>,
  ): Promise<BuildInfo> {
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);

    const body: Record<string, unknown> = {
      template: template.toJSON(),
      alias,
      background: true,
    };

    if (opts?.cpuCount !== undefined) {
      body.cpu_count = opts.cpuCount;
    }
    if (opts?.memoryMb !== undefined) {
      body.memory_mb = opts.memoryMb;
    }
    if (opts?.diskMb !== undefined) {
      body.disk_mb = opts.diskMb;
    }

    const data = await client.post('/templates/build', {
      json: body,
      timeout: opts?.requestTimeout,
    });

    return parseBuildInfo(data as Record<string, unknown>);
  }

  /**
   * Get the status of a template build.
   *
   * Sends GET /templates/builds/:buildId.
   */
  static async getBuildStatus(
    buildId: string,
    opts?: GetBuildStatusOpts,
  ): Promise<TemplateBuildStatus> {
    assertValidBuildId(buildId);
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);

    const data = await client.get(`/templates/builds/${buildId}`, {
      timeout: opts?.requestTimeout,
    });

    return parseTemplateBuildStatus(data as Record<string, unknown>);
  }
}
