import { ApiClient } from '../../api/client.js';
import { CommandExitError } from '../../errors.js';
import { parseCommandResult } from './models.js';
import type { CommandResult } from './models.js';

/**
 * Options for waiting on a command to complete.
 */
export interface CommandWaitOpts {
  /** Callback invoked for each line of stdout. */
  onStdout?: (line: string) => void;
  /** Callback invoked for each line of stderr. */
  onStderr?: (line: string) => void;
}

/**
 * Handle to a running background command.
 *
 * Returned by `Commands.run()` when `background: true`, or by `Commands.connect()`.
 * Use `wait()` to block until the command finishes, or `kill()` to terminate it.
 */
export class CommandHandle {
  private readonly _pid: number;
  private readonly sandboxId: string;
  private readonly client: ApiClient;

  constructor(pid: number, sandboxId: string, client: ApiClient) {
    this._pid = pid;
    this.sandboxId = sandboxId;
    this.client = client;
  }

  /** The process ID of the running command. */
  get pid(): number {
    return this._pid;
  }

  /**
   * Wait for the command to complete and return its result.
   *
   * Sends GET /sandboxes/:id/commands/:pid/wait.
   * If the command exits with a non-zero exit code, throws CommandExitError.
   * Callbacks are invoked line-by-line before any error is thrown.
   */
  async wait(opts?: CommandWaitOpts): Promise<CommandResult> {
    const data = await this.client.get(
      `/sandboxes/${this.sandboxId}/commands/${this._pid}/wait`,
    );
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

    // Throw on non-zero exit code
    if (result.exitCode !== 0) {
      throw new CommandExitError(
        `Command exited with code ${result.exitCode}`,
        {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        },
      );
    }

    return result;
  }

  /**
   * Kill the running command.
   *
   * Sends DELETE /sandboxes/:id/commands/:pid.
   * @returns true if the process was killed, false if it was already dead.
   */
  async kill(): Promise<boolean> {
    const data = await this.client.delete(
      `/sandboxes/${this.sandboxId}/commands/${this._pid}`,
    );
    return (data as Record<string, unknown>).killed === true;
  }

  /**
   * Disconnect from the command handle.
   *
   * Currently a no-op. Reserved for future WebSocket support.
   */
  disconnect(): void {
    // No-op for now
  }
}

/**
 * Split text into lines preserving line endings (like Python's splitlines(keepends=True)).
 */
function splitlines(text: string): string[] {
  const lines: string[] = [];
  const re = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[0] === '') break;
    lines.push(match[0]);
  }
  return lines;
}
