/** Result of executing a command. */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Parse raw JSON data into a CommandResult. */
export function parseCommandResult(data: Record<string, any>): CommandResult {
  return {
    stdout: data.stdout ?? '',
    stderr: data.stderr ?? '',
    exitCode: data.exit_code ?? data.exitCode ?? 0,
  };
}

/** Information about a running process. */
export interface ProcessInfo {
  pid: number;
  cmd: string;
  isPty: boolean;
  envs: Record<string, string>;
}

/** Parse raw JSON data into ProcessInfo. */
export function parseProcessInfo(data: Record<string, any>): ProcessInfo {
  return {
    pid: data.pid ?? 0,
    cmd: data.cmd ?? '',
    isPty: data.is_pty ?? data.isPty ?? false,
    envs: data.envs ?? {},
  };
}

/** Dimensions for a PTY. */
export interface PtySize {
  cols: number;
  rows: number;
}

/** Raw PTY output data. */
export interface PtyOutput {
  data: Uint8Array;
}

/** A line of stdout output. */
export interface Stdout {
  line: string;
  timestamp?: number;
}

/** A line of stderr output. */
export interface Stderr {
  line: string;
  timestamp?: number;
}
