import { ApiClient } from '../../api/client.js';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import { SandboxError } from '../../errors.js';

/** Options for starting an interactive stdio process. */
export interface StdioStartOpts {
  envs?: Record<string, string>;
  user?: string;
  cwd?: string;
  onStdout?: (data: Uint8Array) => void;
  onStderr?: (data: Uint8Array) => void;
  requestTimeout?: number;
}

/** Result returned when a stdio process exits. */
export interface StdioResult {
  exitCode: number;
}

/**
 * Handle for an interactive subprocess with stdin pipe.
 */
export class StdioProcess {
  readonly cmdId: string;
  private readonly sandboxId: string;
  private readonly client: ApiClient;
  private lastEntryId = 0;
  private _exitCode: number | null = null;
  private _bgStream: Promise<StdioResult> | null = null;

  constructor(
    cmdId: string,
    sandboxId: string,
    client: ApiClient,
    opts?: {
      onStdout?: (data: Uint8Array) => void;
      onStderr?: (data: Uint8Array) => void;
    },
  ) {
    this.cmdId = cmdId;
    this.sandboxId = sandboxId;
    this.client = client;
    if (opts?.onStdout || opts?.onStderr) {
      this._bgStream = this.stream({
        onStdout: opts.onStdout,
        onStderr: opts.onStderr,
      });
    }
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  async sendStdin(data: string | Uint8Array, requestTimeout?: number): Promise<void> {
    const raw = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    let binary = '';
    for (let i = 0; i < raw.length; i++) {
      binary += String.fromCharCode(raw[i]);
    }
    const encoded = btoa(binary);
    await this.client.post(
      `/sandboxes/${this.sandboxId}/stdio/${this.cmdId}/stdin`,
      {
        json: { data: encoded },
        timeout: requestTimeout,
      },
    );
  }

  async closeStdin(requestTimeout?: number): Promise<void> {
    await this.client.post(
      `/sandboxes/${this.sandboxId}/stdio/${this.cmdId}/stdin/close`,
      { timeout: requestTimeout },
    );
  }

  async kill(requestTimeout?: number): Promise<boolean> {
    const resp = await this.client.delete(
      `/sandboxes/${this.sandboxId}/stdio/${this.cmdId}`,
      { timeout: requestTimeout },
    );
    return Boolean((resp as Record<string, unknown>).killed);
  }

  async wait(): Promise<StdioResult> {
    if (this._bgStream) {
      return this._bgStream;
    }
    return this.stream();
  }

  async stream(opts?: {
    onStdout?: (data: Uint8Array) => void;
    onStderr?: (data: Uint8Array) => void;
  }): Promise<StdioResult> {
    if (this._bgStream && !opts) {
      return this._bgStream;
    }
    let url = `/sandboxes/${this.sandboxId}/stdio/${this.cmdId}/stream`;
    if (this.lastEntryId > 0) {
      url += `?last_entry_id=${this.lastEntryId}`;
    }

    const response = await this.client.streamGet(url);
    const stream = response.body;
    if (!stream) {
      throw new SandboxError('No response body for stdio stream');
    }

    const eventStream = stream
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream());

    for await (const event of eventStream) {
      if (event.event === 'exit') {
        try {
          const parsed = JSON.parse(event.data);
          this._exitCode = parsed.exit_code ?? -1;
        } catch {
          this._exitCode = -1;
        }
        break;
      }
      if (event.event === 'stdout' || event.event === 'stderr') {
        try {
          const parsed = JSON.parse(event.data);
          const entryId = parsed.entry_id ?? 0;
          if (entryId > this.lastEntryId) {
            this.lastEntryId = entryId;
          }
          const raw = atob(parsed.data ?? '');
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) {
            bytes[i] = raw.charCodeAt(i);
          }
          if (event.event === 'stdout' && opts?.onStdout) {
            opts.onStdout(bytes);
          } else if (event.event === 'stderr' && opts?.onStderr) {
            opts.onStderr(bytes);
          }
        } catch {
          continue;
        }
      }
    }

    return { exitCode: this._exitCode ?? -1 };
  }
}

/**
 * Module for interactive stdio subprocess sessions in the sandbox.
 */
export class Stdio {
  private readonly sandboxId: string;
  private readonly client: ApiClient;

  constructor(sandboxId: string, client: ApiClient) {
    this.sandboxId = sandboxId;
    this.client = client;
  }

  async start(cmd: string, opts?: StdioStartOpts): Promise<StdioProcess> {
    const user = opts?.user ?? 'user';
    const body: Record<string, unknown> = { cmd, user };
    if (opts?.envs) body.envs = opts.envs;
    if (opts?.cwd) body.cwd = opts.cwd;

    const data = await this.client.post(
      `/sandboxes/${this.sandboxId}/stdio`,
      { json: body, timeout: opts?.requestTimeout },
    );
    const cmdId = (data as Record<string, string>).cmd_id;
    return new StdioProcess(cmdId, this.sandboxId, this.client, {
      onStdout: opts?.onStdout,
      onStderr: opts?.onStderr,
    });
  }
}
