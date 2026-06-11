import { ApiClient } from '../../api/client.js';
import type { PtySize } from '../commands/models.js';

/** Outcome of a PTY session — produced by `PtyHandle.wait()`. */
export interface PtyResult {
  /** Remote shell exit code. `-1` if the stream dropped before a clean exit frame. */
  exitCode: number;
}

/** Options for attaching to a running PTY via `Pty.connect()`. */
export interface PtyConnectOpts {
  /**
   * Callback invoked with every chunk of PTY output as raw bytes.
   * Optional — omit to drive the stream via the handle's async iterator.
   */
  onData?: (data: Uint8Array) => void;
}

/** Options for creating a PTY session. */
export interface PtyCreateOpts {
  /** Terminal size. Defaults to { cols: 80, rows: 24 }. */
  size?: PtySize;
  /** User to run as. Defaults to 'user'. */
  user?: string;
  /** Working directory. */
  cwd?: string;
  /** Environment variables. */
  envs?: Record<string, string>;
  /**
   * PTY session TTL in seconds. Defaults to 3600 (1 hour). Pass `0` to
   * keep the session alive indefinitely — it will still die when the
   * parent sandbox's timeout fires.
   */
  timeout?: number;
  /** Per-request timeout in milliseconds (applies to the initial create call only). */
  requestTimeout?: number;
  /**
   * Callback invoked with every chunk of PTY output as raw bytes.
   * Setting this implicitly opens the SSE stream; the returned handle's
   * `wait()` resolves when the remote process exits. Drop this option
   * and call `handle.stream()` directly if you want to drive the iterator
   * explicitly instead.
   */
  onData?: (data: Uint8Array) => void;
}

/**
 * Handle to a running PTY session. Returned from `Pty.create()`.
 *
 * Exposes stdin / resize / kill plus a `wait()` that resolves with the
 * remote exit code once the process terminates. The output stream runs
 * over Server-Sent Events — configured via `onData` at create time or
 * consumed manually with `stream()`.
 */
export class PtyHandle {
  readonly pid: number;
  private readonly sandboxId: string;
  private readonly client: ApiClient;
  private readonly exitPromise: Promise<PtyResult>;
  private resolveExit!: (result: PtyResult) => void;
  private aborter = new AbortController();

  constructor(
    pid: number,
    sandboxId: string,
    client: ApiClient,
    onData?: (data: Uint8Array) => void,
  ) {
    this.pid = pid;
    this.sandboxId = sandboxId;
    this.client = client;
    this.exitPromise = new Promise<PtyResult>((resolve) => {
      this.resolveExit = resolve;
    });
    if (onData) {
      void this.consumeStream(onData);
    }
  }

  /** Forward keystrokes to the PTY. */
  async sendInput(
    data: Uint8Array | string,
    requestTimeout?: number,
  ): Promise<void> {
    const strData = typeof data === 'string' ? data : new TextDecoder().decode(data);
    await this.client.post(
      `/sandboxes/${this.sandboxId}/pty/${this.pid}/stdin`,
      { json: { data: strData }, timeout: requestTimeout },
    );
  }

  /** Update the terminal size (TIOCSWINSZ inside the VM). */
  async resize(size: PtySize, requestTimeout?: number): Promise<void> {
    await this.client.patch(
      `/sandboxes/${this.sandboxId}/pty/${this.pid}`,
      {
        json: { size: { cols: size.cols, rows: size.rows } },
        timeout: requestTimeout,
      },
    );
  }

  /** SIGKILL the remote process and close any open streams. */
  async kill(requestTimeout?: number): Promise<boolean> {
    this.aborter.abort();
    const data = await this.client.delete(
      `/sandboxes/${this.sandboxId}/pty/${this.pid}`,
      { timeout: requestTimeout },
    );
    return (data as Record<string, unknown>).killed === true;
  }

  /**
   * Stop consuming output without killing the process. The PTY keeps
   * running server-side and a fresh `stream()` call reattaches.
   */
  disconnect(): void {
    this.aborter.abort();
  }

  /** Resolves with the remote exit result when the PTY process exits. */
  wait(): Promise<PtyResult> {
    return this.exitPromise;
  }

  /**
   * Async iterator over raw output chunks. Use when you want to drive
   * the stream yourself:
   *
   *   for await (const chunk of handle.stream()) { ... }
   *
   * Don't mix this with `onData` on the same handle — they both try to
   * consume the same underlying SSE connection.
   */
  async *stream(): AsyncGenerator<Uint8Array, void, void> {
    const response = await this.client.streamGet(
      `/sandboxes/${this.sandboxId}/pty/${this.pid}/stream`,
      { timeout: undefined },
    );
    if (!response.body) {
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        if (this.aborter.signal.aborted) return;
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const parsed = parseSSEFrame(frame);
          if (!parsed) continue;
          if (parsed.event === 'exit') {
            this.resolveExit({ exitCode: parsed.exitCode ?? -1 });
            return;
          }
          if (parsed.bytes) {
            yield parsed.bytes;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async consumeStream(onData: (data: Uint8Array) => void): Promise<void> {
    try {
      for await (const chunk of this.stream()) {
        onData(chunk);
      }
    } catch (err) {
      // If the stream aborts after an explicit disconnect/kill, that's fine.
      if (!this.aborter.signal.aborted) {
        throw err;
      }
    } finally {
      // If stream() returned without an exit frame (e.g. connection drop),
      // still unblock wait() so callers don't hang forever.
      this.resolveExit({ exitCode: -1 });
    }
  }
}

interface ParsedSSEFrame {
  event: string;
  bytes?: Uint8Array;
  exitCode?: number;
}

function parseSSEFrame(frame: string): ParsedSSEFrame | null {
  let event = 'message';
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!event) return null;
  if (event === 'exit') {
    try {
      const parsed = JSON.parse(data) as { exit_code?: number };
      return { event, exitCode: parsed.exit_code ?? -1 };
    } catch {
      return { event, exitCode: -1 };
    }
  }
  if (event === 'data') {
    try {
      const parsed = JSON.parse(data) as { data?: string };
      if (typeof parsed.data === 'string') {
        const bin = atob(parsed.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { event, bytes };
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * PTY (pseudo-terminal) interface for a sandbox.
 *
 * Use `create()` to launch a fresh shell session. The returned
 * `PtyHandle` exposes stdin / resize / kill plus a live output stream
 * (callback or async iterator).
 */
export class Pty {
  private readonly sandboxId: string;
  private readonly client: ApiClient;

  constructor(sandboxId: string, client: ApiClient) {
    this.sandboxId = sandboxId;
    this.client = client;
  }

  async create(opts?: PtyCreateOpts): Promise<PtyHandle> {
    const size = opts?.size ?? { cols: 80, rows: 24 };
    const user = opts?.user ?? 'user';

    const body: Record<string, unknown> = {
      size: { cols: size.cols, rows: size.rows },
      user,
      timeout: opts?.timeout ?? 3600,
    };
    if (opts?.cwd !== undefined) body.cwd = opts.cwd;
    if (opts?.envs !== undefined) body.envs = opts.envs;

    const data = await this.client.post(
      `/sandboxes/${this.sandboxId}/pty`,
      { json: body, timeout: opts?.requestTimeout },
    );
    const pid = (data as Record<string, unknown>).pid as number;
    return new PtyHandle(pid, this.sandboxId, this.client, opts?.onData);
  }

  /**
   * Reattach to an already-running PTY by its pid.
   *
   * Returns a fresh `PtyHandle` that streams the live output of the
   * existing session. Multiple clients can subscribe to the same pid
   * concurrently — each receives output from the moment it connects
   * (no scrollback replay).
   */
  connect(pid: number, opts?: PtyConnectOpts): PtyHandle {
    return new PtyHandle(pid, this.sandboxId, this.client, opts?.onData);
  }

  // --- Low-level API by pid (kept for callers that already hold one). ---

  async kill(pid: number, requestTimeout?: number): Promise<boolean> {
    const data = await this.client.delete(
      `/sandboxes/${this.sandboxId}/pty/${pid}`,
      { timeout: requestTimeout },
    );
    return (data as Record<string, unknown>).killed === true;
  }

  async sendStdin(
    pid: number,
    data: Uint8Array | string,
    requestTimeout?: number,
  ): Promise<void> {
    const strData = typeof data === 'string' ? data : new TextDecoder().decode(data);
    await this.client.post(
      `/sandboxes/${this.sandboxId}/pty/${pid}/stdin`,
      { json: { data: strData }, timeout: requestTimeout },
    );
  }

  async resize(
    pid: number,
    size: PtySize,
    requestTimeout?: number,
  ): Promise<void> {
    await this.client.patch(
      `/sandboxes/${this.sandboxId}/pty/${pid}`,
      {
        json: { size: { cols: size.cols, rows: size.rows } },
        timeout: requestTimeout,
      },
    );
  }
}
