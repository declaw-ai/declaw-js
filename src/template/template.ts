import { ConnectionConfig } from '../connectionConfig.js';
import { getSharedClient } from '../api/client.js';
import {
  AuthenticationError,
  BuildError,
  ConflictError,
  InvalidArgumentError,
  NotEnoughSpaceError,
  NotFoundError,
  SandboxError,
  TimeoutError,
} from '../errors.js';
import type { TemplateBase } from './models.js';
import type { BuildInfo, TemplateBuildStatus } from './models.js';
import { parseBuildInfo, parseTemplateBuildStatus } from './models.js';

const VALID_BUILD_ID_RE = /^[a-zA-Z0-9_-]+$/;

/** Build states reported by the API. */
const BUILD_STATUS_COMPLETED = 'completed';
const BUILD_STATUS_FAILED = 'failed';

/**
 * Default for how long `Template.build()` waits, in milliseconds. The server
 * fails a build after 30 minutes, and marks a stranded one failed well within
 * an hour, so this only bounds the wait for a build that is still progressing.
 */
const DEFAULT_BUILD_TIMEOUT_MS = 60 * 60 * 1000;

/** How much build output a `BuildError` message quotes. */
const FAILURE_LOG_LINES = 20;

/**
 * How `Template.build()` polls a running build. Mutable so tests can shorten it.
 * @internal
 */
export const buildPolling = {
  /** How often a waiting build is re-read. */
  intervalMs: 3000,
  /**
   * How long status checks may keep failing temporarily (5xx, 408, 429, or no
   * response) before the wait gives up. It rides out a sandbox-manager
   * restart; the build itself keeps running.
   */
  errorWindowMs: 2 * 60 * 1000,
};

/**
 * The line sandbox-manager puts first once it starts dropping a build's oldest
 * output (store.BuildLogTruncationNotice). It must match exactly: it is how
 * LogCursor tells a trimmed log from a growing one.
 */
const BUILD_LOG_TRUNCATION_NOTICE = '... [earlier build output truncated]';

/** How many of the newest delivered lines LogCursor looks for in a trimmed log. */
const LOG_ANCHOR_LINES = 64;

/** Failed status checks that waiting cannot change: the API rejected the request. */
const REJECTIONS = [
  AuthenticationError,
  ConflictError,
  InvalidArgumentError,
  NotEnoughSpaceError,
  NotFoundError,
];

/**
 * Hands out each line of a build's log once across repeated polls.
 *
 * The server keeps a bounded number of lines. Until it hits the bound the log
 * only grows, and the new lines are those past the last length seen. After, it
 * drops the oldest lines and puts BUILD_LOG_TRUNCATION_NOTICE first, so the
 * length stops changing and positions shift between polls; the cursor then
 * finds the newest lines it already handed out and continues after them. If
 * none of those is left (more output arrived between two polls than the server
 * keeps), the gap is marked by handing out the notice itself, followed by what
 * remains.
 * @internal
 */
export class LogCursor {
  private seen = 0;
  private tail: string[] = [];

  newLines(logs: string[]): string[] {
    const fresh =
      logs.length === 0 || logs[0] !== BUILD_LOG_TRUNCATION_NOTICE
        ? logs.slice(this.seen)
        : this.afterTail(logs);
    this.seen = logs.length;
    this.tail = [...this.tail, ...fresh].slice(-LOG_ANCHOR_LINES);
    return fresh;
  }

  private afterTail(logs: string[]): string[] {
    const window = logs.slice(1);
    const n = this.tail.length;
    if (n > 0) {
      for (let end = window.length; end >= n; end--) {
        if (window[end - 1] === this.tail[n - 1] && this.tail.every((line, i) => window[end - n + i] === line)) {
          return window.slice(end);
        }
      }
    }
    return logs;
  }
}

/** Whether a failed status check is worth repeating rather than ending the wait. */
function isTemporaryPollError(err: unknown): boolean {
  return err instanceof SandboxError && !REJECTIONS.some((Rejection) => err instanceof Rejection);
}

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
  /** Called with each new line of build output while `build()` waits. */
  onBuildLogs?: (log: string) => void;
  /** How long `build()` waits for the build to finish, in milliseconds. Defaults to one hour. */
  buildTimeout?: number;
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
 * Options for Template.rebuild() and Template.rebuildInBackground(). A rebuild
 * reuses the template's stored spec, so there are no resources to set.
 */
export type TemplateRebuildOpts = Omit<TemplateBuildOpts, 'cpuCount' | 'memoryMb' | 'diskMb'>;

/** Validate that a template ID is safe for URL path interpolation. */
function assertValidTemplateId(templateId: string): void {
  if (!templateId || !VALID_BUILD_ID_RE.test(templateId)) {
    throw new InvalidArgumentError(
      `Invalid template ID: "${templateId}". Must be alphanumeric with hyphens/underscores only.`,
    );
  }
}

/**
 * Body for `POST /templates/build`: the spec nested under `template`, with the
 * alias and resources beside it.
 */
function buildRequestBody(
  template: TemplateBase,
  alias: string,
  opts?: Omit<TemplateBuildOpts, 'onBuildLogs'>,
): Record<string, unknown> {
  if (template.hasCopies()) {
    throw new InvalidArgumentError(
      'TemplateBase.copy() is not supported yet: a template build cannot upload local files. ' +
        'Fetch them in a runCmd step, or use fromDockerfile().',
    );
  }

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
  return body;
}

/** The error for a failed build, quoting the end of its logs. */
function buildFailedError(status: TemplateBuildStatus): BuildError {
  let message = `template build ${status.buildId} failed`;
  const tail = status.logs.slice(-FAILURE_LOG_LINES);
  if (tail.length > 0) {
    message += ':\n' + tail.join('\n');
  }
  return new BuildError(message, {
    buildId: status.buildId,
    templateId: status.templateId,
    logs: status.logs,
  });
}

/**
 * Poll a started build until it finishes: the loop `build()` and `rebuild()`
 * share. Resolves with the completed build, throws `BuildError` for a failed
 * one and `TimeoutError` at `buildTimeout` (the build keeps running).
 */
async function waitForBuild(
  client: ReturnType<typeof getSharedClient>,
  info: BuildInfo,
  opts?: Pick<TemplateBuildOpts, 'onBuildLogs' | 'buildTimeout' | 'requestTimeout'>,
): Promise<BuildInfo> {
  let status: TemplateBuildStatus = {
    buildId: info.buildId,
    status: info.status,
    logs: info.logs,
    templateId: info.templateId,
  };
  const buildTimeout = opts?.buildTimeout ?? DEFAULT_BUILD_TIMEOUT_MS;
  const deadline = Date.now() + buildTimeout;
  const timedOut = (cause?: unknown) =>
    new TimeoutError(
      `template build ${info.buildId} was still running after ${buildTimeout}ms. ` +
        `It keeps running; follow it with Template.getBuildStatus('${info.buildId}').` +
        (cause instanceof Error ? ` Last status check: ${cause.message}` : ''),
    );
  const cursor = new LogCursor();
  for (;;) {
    if (opts?.onBuildLogs) {
      for (const line of cursor.newLines(status.logs)) {
        opts.onBuildLogs(line);
      }
    }

    if (status.status === BUILD_STATUS_COMPLETED) {
      return {
        buildId: status.buildId,
        status: status.status,
        templateId: status.templateId ?? info.templateId,
        logs: status.logs,
      };
    }
    if (status.status === BUILD_STATUS_FAILED) {
      throw buildFailedError(status);
    }
    if (Date.now() >= deadline) {
      throw timedOut();
    }

    // Read the next status, repeating through temporary failures for up to
    // buildPolling.errorWindowMs (and never past the deadline).
    let failingSince: number | undefined;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, buildPolling.intervalMs));
      try {
        const next = await client.get(`/templates/builds/${info.buildId}`, {
          timeout: opts?.requestTimeout,
        });
        status = parseTemplateBuildStatus(next as Record<string, unknown>);
        break;
      } catch (err) {
        if (!isTemporaryPollError(err)) {
          throw err;
        }
        failingSince ??= Date.now();
        if (Date.now() - failingSince >= buildPolling.errorWindowMs) {
          throw err;
        }
        if (Date.now() >= deadline) {
          throw timedOut(err);
        }
      }
    }
  }
}

/**
 * Template management.
 *
 * All methods are static and create their own temporary ApiClient,
 * ensuring the client is always closed via try/finally (fixing Python SDK's client leak).
 */
export class Template {
  /**
   * Build a template and wait for the build to finish.
   *
   * Builds usually take several minutes. While waiting, each new line of build
   * output is passed to `onBuildLogs`. Sandboxes are created from the finished
   * template by its alias: `Sandbox.create({ template: alias })`.
   *
   * @throws {BuildError} The build failed; the error carries its logs.
   * @throws {TimeoutError} The build was still running after `buildTimeout`.
   *   It keeps running; follow it with `getBuildStatus()`.
   * @throws {InvalidArgumentError} The template uses `copy()`, which is not
   *   supported yet.
   */
  static async build(
    template: TemplateBase,
    alias: string,
    opts?: TemplateBuildOpts,
  ): Promise<BuildInfo> {
    const body = buildRequestBody(template, alias, opts);
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);

    const data = await client.post('/templates/build', {
      json: body,
      timeout: opts?.requestTimeout,
    });
    const info = parseBuildInfo(data as Record<string, unknown>);
    assertValidBuildId(info.buildId);

    return waitForBuild(client, info, opts);
  }

  /**
   * Start a template build and return as soon as the server has accepted it,
   * with status `building`. Follow the build with `getBuildStatus()`.
   */
  static async buildInBackground(
    template: TemplateBase,
    alias: string,
    opts?: Omit<TemplateBuildOpts, 'onBuildLogs' | 'buildTimeout'>,
  ): Promise<BuildInfo> {
    const body = buildRequestBody(template, alias, opts);
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);

    const data = await client.post('/templates/build', {
      json: body,
      timeout: opts?.requestTimeout,
    });

    return parseBuildInfo(data as Record<string, unknown>);
  }

  /**
   * Re-run the build of a template whose last build failed, and wait for it
   * like `build()`: it resolves with the completed build, throws `BuildError`
   * for a failed one and `TimeoutError` at `buildTimeout` (the build keeps
   * running; follow it with `getBuildStatus()`).
   *
   * Templates are immutable once built, so this is a recovery path only: the
   * rebuild reuses the template's stored spec, and a template that is `ready`,
   * or whose build is still running, is refused with `ConflictError`. A failed
   * template keeps its alias — `build()` with the same alias is refused with a
   * `ConflictError` naming the template to rebuild — and rebuilding is cheaper
   * than deleting it and starting over.
   *
   * Sends POST /templates/:templateId/rebuild.
   */
  static async rebuild(templateId: string, opts?: TemplateRebuildOpts): Promise<BuildInfo> {
    assertValidTemplateId(templateId);
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);

    const data = await client.post(`/templates/${templateId}/rebuild`, {
      timeout: opts?.requestTimeout,
    });
    const info = parseBuildInfo(data as Record<string, unknown>);
    assertValidBuildId(info.buildId);

    return waitForBuild(client, info, opts);
  }

  /**
   * Queue a rebuild of a failed template and return as soon as the server has
   * accepted it, with status `building`. Follow the build with
   * `getBuildStatus()`. See `rebuild()` for when a rebuild is allowed.
   */
  static async rebuildInBackground(
    templateId: string,
    opts?: Omit<TemplateRebuildOpts, 'onBuildLogs' | 'buildTimeout'>,
  ): Promise<BuildInfo> {
    assertValidTemplateId(templateId);
    const config = new ConnectionConfig({
      apiKey: opts?.apiKey,
      domain: opts?.domain,
      requestTimeout: opts?.requestTimeout,
    });
    const client = getSharedClient(config);

    const data = await client.post(`/templates/${templateId}/rebuild`, {
      timeout: opts?.requestTimeout,
    });

    return parseBuildInfo(data as Record<string, unknown>);
  }

  /**
   * Get the status of a template build, including its logs so far.
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
