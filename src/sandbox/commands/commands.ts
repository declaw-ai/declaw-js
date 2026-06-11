import { ApiClient } from '../../api/client.js';
import { parseCommandResult, parseProcessInfo } from './models.js';
import type { CommandResult, ProcessInfo } from './models.js';
import { CommandHandle } from './commandHandle.js';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import { SandboxError } from '../../errors.js';

/**
 * Options for running a command in a sandbox.
 */
export interface RunOpts {
  /** Run the command in the background. Default: false. */
  background?: boolean;
  /** Environment variables to set for the command. */
  envs?: Record<string, string>;
  /** User to run the command as. Default: 'user'. */
  user?: string;
  /** Working directory for the command. */
  cwd?: string;
  /** Command timeout in seconds. Default: 60. */
  timeout?: number;
  /** Per-request HTTP timeout in milliseconds. */
  requestTimeout?: number;
  /** Callback invoked for each line of stdout (foreground only). */
  onStdout?: (line: string) => void;
  /** Callback invoked for each line of stderr (foreground only). */
  onStderr?: (line: string) => void;
}

/**
 * Options for running a streaming command in a sandbox.
 */
export interface RunStreamOpts {
  /** Environment variables to set for the command. */
  envs?: Record<string, string>;
  /** User to run the command as. Default: 'user'. */
  user?: string;
  /** Working directory for the command. */
  cwd?: string;
  /** Command timeout in seconds. Default: 60. */
  timeout?: number;
  /** Callback invoked for each chunk of stdout as it arrives. */
  onStdout?: (line: string) => void;
  /** Callback invoked for each chunk of stderr as it arrives. */
  onStderr?: (line: string) => void;
}

/**
 * Manage commands in a sandbox.
 *
 * Provides methods to run, list, kill, and interact with commands
 * running inside a sandbox.
 */
export class Commands {
  private readonly sandboxId: string;
  private readonly client: ApiClient;

  constructor(sandboxId: string, client: ApiClient) {
    this.sandboxId = sandboxId;
    this.client = client;
  }

  /**
   * Run a command in the background and return a handle.
   */
  async run(cmd: string, opts: RunOpts & { background: true }): Promise<CommandHandle>;
  /**
   * Run a command in the foreground and return its result.
   */
  async run(cmd: string, opts?: RunOpts): Promise<CommandResult>;
  async run(
    cmd: string,
    opts?: RunOpts,
  ): Promise<CommandResult | CommandHandle> {
    const background = opts?.background ?? false;
    const user = opts?.user ?? 'user';
    const timeout = opts?.timeout ?? 60;

    const body: Record<string, unknown> = {
      cmd,
      background,
      user,
      timeout,
    };

    if (opts?.envs !== undefined) {
      body.envs = opts.envs;
    }
    if (opts?.cwd !== undefined) {
      body.cwd = opts.cwd;
    }

    const data = await this.client.post(
      `/sandboxes/${this.sandboxId}/commands`,
      {
        json: body,
        timeout: opts?.requestTimeout,
      },
    );

    if (background) {
      const pid = (data as Record<string, unknown>).pid as number;
      return new CommandHandle(pid, this.sandboxId, this.client);
    }

    const result = parseCommandResult(data as Record<string, unknown>);

    // Invoke callbacks line-by-line (matching Python SDK's splitlines(keepends=True))
    if (opts?.onStdout && result.stdout) {
      for (const line of splitlines(result.stdout)) {
        opts.onStdout(line);
      }
    }
    if (opts?.onStderr && result.stderr) {
      for (const line of splitlines(result.stderr)) {
        opts.onStderr(line);
      }
    }

    return result;
  }

  /**
   * Run a command with real-time SSE streaming of stdout/stderr.
   *
   * Sends POST /sandboxes/:id/commands/stream and reads the response as
   * Server-Sent Events. Callbacks are invoked in real-time as output arrives.
   * Returns the accumulated CommandResult when the command completes.
   */
  async runStream(cmd: string, opts?: RunStreamOpts): Promise<CommandResult> {
    const user = opts?.user ?? 'user';
    const timeout = opts?.timeout ?? 60;

    const body: Record<string, unknown> = {
      cmd,
      stream: true,
      user,
      timeout,
    };

    if (opts?.envs !== undefined) {
      body.envs = opts.envs;
    }
    if (opts?.cwd !== undefined) {
      body.cwd = opts.cwd;
    }

    const response = await this.client.stream(
      `/sandboxes/${this.sandboxId}/commands/stream`,
      { json: body },
    );

    if (!response.body) {
      throw new SandboxError('Stream response has no body');
    }

    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    const eventStream = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream());

    const reader = eventStream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(value.data) as Record<string, unknown>;
        } catch {
          // Skip malformed SSE events (matching Python SDK's json.JSONDecodeError handling)
          continue;
        }

        // Error event
        if (parsed.error !== undefined) {
          throw new SandboxError(parsed.error as string);
        }

        // Exit event
        if (parsed.exit_code !== undefined) {
          exitCode = parsed.exit_code as number;
          break;
        }

        // Output event
        const type = parsed.type as string;
        const data = parsed.data as string;

        if (type === 'stdout') {
          stdout += data;
          opts?.onStdout?.(data);
        } else if (type === 'stderr') {
          stderr += data;
          opts?.onStderr?.(data);
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { stdout, stderr, exitCode };
  }

  /**
   * List all running commands in the sandbox.
   *
   * Sends GET /sandboxes/:id/commands.
   * @returns Array of ProcessInfo for each running process.
   */
  async list(requestTimeout?: number): Promise<ProcessInfo[]> {
    const data = await this.client.get(
      `/sandboxes/${this.sandboxId}/commands`,
      { timeout: requestTimeout },
    );
    const items = (data ?? []) as Record<string, unknown>[];
    return items.map(parseProcessInfo);
  }

  /**
   * Kill a running command by PID.
   *
   * Sends DELETE /sandboxes/:id/commands/:pid.
   * @returns true if the process was killed, false if already dead.
   */
  async kill(pid: number, requestTimeout?: number): Promise<boolean> {
    const data = await this.client.delete(
      `/sandboxes/${this.sandboxId}/commands/${pid}`,
      { timeout: requestTimeout },
    );
    return (data as Record<string, unknown>).killed === true;
  }

  /**
   * Send data to the stdin of a running command.
   *
   * Sends POST /sandboxes/:id/commands/:pid/stdin.
   */
  async sendStdin(pid: number, data: string, requestTimeout?: number): Promise<void> {
    await this.client.post(
      `/sandboxes/${this.sandboxId}/commands/${pid}/stdin`,
      {
        json: { data },
        timeout: requestTimeout,
      },
    );
  }

  /**
   * Connect to an existing running command by PID.
   *
   * Returns a CommandHandle without making any API call.
   */
  connect(pid: number): CommandHandle {
    return new CommandHandle(pid, this.sandboxId, this.client);
  }
}

/**
 * Split text into lines preserving line endings (like Python's splitlines(keepends=True)).
 * Each line includes its trailing \n (or \r\n). The last line is included even without
 * a trailing newline.
 */
function splitlines(text: string): string[] {
  const lines: string[] = [];
  const re = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[0] === '') break; // End of string
    lines.push(match[0]);
  }
  return lines;
}
