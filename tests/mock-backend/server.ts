/**
 * Mock Declaw API backend for integration testing.
 *
 * Implements the full REST API with in-memory state, real subprocess execution,
 * and real filesystem operations scoped to per-sandbox temp directories.
 *
 * Uses only node:http — no external frameworks.
 */
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

interface SandboxRecord {
  sandbox_id: string;
  template_id: string;
  name: string;
  metadata: Record<string, string>;
  envs: Record<string, string>;
  network: unknown;
  security: unknown;
  lifecycle: unknown;
  state: string;
  started_at: string;
  end_at: string | null;
  timeout: number;
  envd_access_token: string;
  sandbox_domain: string;
  traffic_access_token: string;
}

interface ProcessRecord {
  cmd: string;
  envs: Record<string, string>;
  cwd: string;
  is_pty: boolean;
}

let sandboxes: Map<string, SandboxRecord> = new Map();
let sandboxDirs: Map<string, string> = new Map();
let processes: Map<string, Map<number, ProcessRecord>> = new Map();
let pidCounter = 100;

function nextPid(): number {
  pidCounter += 1;
  return pidCounter;
}

function shortId(): string {
  return crypto.randomBytes(4).toString('hex');
}

/** Reset all in-memory state. Useful for test isolation. */
export function resetState(): void {
  // Clean up temp dirs
  for (const dir of sandboxDirs.values()) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  sandboxes = new Map();
  sandboxDirs = new Map();
  processes = new Map();
  pidCounter = 100;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSandbox(sandboxId: string): SandboxRecord | null {
  return sandboxes.get(sandboxId) ?? null;
}

function getSandboxOrThrow(sandboxId: string): SandboxRecord {
  const sbx = getSandbox(sandboxId);
  if (!sbx) {
    throw { status: 404, body: { message: `Sandbox ${sandboxId} not found` } };
  }
  return sbx;
}

function getSandboxDir(sandboxId: string): string {
  getSandboxOrThrow(sandboxId);
  let dir = sandboxDirs.get(sandboxId);
  if (!dir) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), `declaw-${sandboxId}-`));
    fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'home', 'user'), { recursive: true });
    sandboxDirs.set(sandboxId, dir);
  }
  return dir;
}

function buildEnv(
  sandboxId: string,
  sbx: SandboxRecord,
  extra?: Record<string, string>,
): Record<string, string> {
  const dir = getSandboxDir(sandboxId);
  const envs: Record<string, string> = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'SHELL']) {
    if (process.env[key]) {
      envs[key] = process.env[key]!;
    }
  }
  Object.assign(envs, sbx.envs ?? {});
  if (extra) Object.assign(envs, extra);
  envs['DECLAW_SANDBOX_ID'] = sandboxId;
  envs['DECLAW_SANDBOX'] = 'true';
  envs['HOME'] = path.join(dir, 'home', 'user');
  envs['TMPDIR'] = path.join(dir, 'tmp');
  return envs;
}

// ---------------------------------------------------------------------------
// Request parsing helpers
// ---------------------------------------------------------------------------

function parseUrl(reqUrl: string): { pathname: string; query: URLSearchParams } {
  const url = new URL(reqUrl, 'http://localhost');
  return { pathname: url.pathname, query: url.searchParams };
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw { status: 400, body: { message: 'Invalid JSON' } };
  }
}

function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res: http.ServerResponse, data: string, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function send404(res: http.ServerResponse, message: string): void {
  sendJson(res, { message }, 404);
}

// ---------------------------------------------------------------------------
// Route matching
// ---------------------------------------------------------------------------

type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: Record<string, string>,
  query: URLSearchParams,
) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

const routes: Route[] = [];

function addRoute(method: string, pathPattern: string, handler: RouteHandler): void {
  const paramNames: string[] = [];
  const regexStr = pathPattern.replace(/:(\w+)/g, (_match, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  routes.push({
    method,
    pattern: new RegExp(`^${regexStr}$`),
    paramNames,
    handler,
  });
}

function matchRoute(
  method: string,
  pathname: string,
): { handler: RouteHandler; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const m = pathname.match(route.pattern);
    if (m) {
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = m[i + 1];
      });
      return { handler: route.handler, params };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Route implementations
// ---------------------------------------------------------------------------

// POST /sandboxes — create sandbox
addRoute('POST', '/sandboxes', async (req, res) => {
  const body = await parseJsonBody(req);
  const sandboxId = `sbx-${shortId()}`;
  const now = new Date().toISOString();
  const sandbox: SandboxRecord = {
    sandbox_id: sandboxId,
    template_id: `tpl-${(body.template as string) ?? 'base'}`,
    name: (body.template as string) ?? 'base',
    metadata: (body.metadata as Record<string, string>) ?? {},
    envs: (body.envs as Record<string, string>) ?? {},
    network: body.network ?? null,
    security: body.security ?? null,
    lifecycle: body.lifecycle ?? null,
    state: 'running',
    started_at: now,
    end_at: null,
    timeout: (body.timeout as number) ?? 300,
    envd_access_token: `envd-tok-${shortId()}`,
    sandbox_domain: 'mock.declaw.dev',
    traffic_access_token: `traffic-${shortId()}`,
  };
  sandboxes.set(sandboxId, sandbox);
  processes.set(sandboxId, new Map());
  // Create temp directory eagerly
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `declaw-${sandboxId}-`));
  fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'home', 'user'), { recursive: true });
  sandboxDirs.set(sandboxId, dir);
  sendJson(res, sandbox, 201);
});

// GET /sandboxes — list sandboxes
addRoute('GET', '/sandboxes', async (_req, res, _params, query) => {
  const limit = parseInt(query.get('limit') ?? '50', 10);
  const all = Array.from(sandboxes.values());
  sendJson(res, { sandboxes: all.slice(0, limit), next_token: null });
});

// GET /sandboxes/:sandbox_id — get sandbox info
addRoute('GET', '/sandboxes/:sandbox_id', async (_req, res, params) => {
  const sbx = getSandboxOrThrow(params.sandbox_id);
  sendJson(res, sbx);
});

// DELETE /sandboxes/:sandbox_id — kill sandbox
addRoute('DELETE', '/sandboxes/:sandbox_id', async (_req, res, params) => {
  const sbx = getSandboxOrThrow(params.sandbox_id);
  sbx.state = 'killed';
  const dir = sandboxDirs.get(params.sandbox_id);
  if (dir) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    sandboxDirs.delete(params.sandbox_id);
  }
  sendJson(res, { killed: true });
});

// GET /sandboxes/:sandbox_id/status — check if running
addRoute('GET', '/sandboxes/:sandbox_id/status', async (_req, res, params) => {
  const sbx = getSandboxOrThrow(params.sandbox_id);
  sendJson(res, { is_running: sbx.state === 'running' });
});

// PATCH /sandboxes/:sandbox_id/timeout — update timeout
addRoute('PATCH', '/sandboxes/:sandbox_id/timeout', async (req, res, params) => {
  const sbx = getSandboxOrThrow(params.sandbox_id);
  const body = await parseJsonBody(req);
  sbx.timeout = body.timeout as number;
  sendJson(res, { ok: true });
});

// GET /sandboxes/:sandbox_id/metrics — return mock metrics
addRoute('GET', '/sandboxes/:sandbox_id/metrics', async (_req, res, params) => {
  getSandboxOrThrow(params.sandbox_id);
  sendJson(res, [
    {
      timestamp: new Date().toISOString(),
      cpu_usage_percent: 12.5,
      memory_usage_mb: 128.0,
      disk_usage_mb: 50.0,
    },
  ]);
});

// POST /sandboxes/:sandbox_id/pause — pause sandbox
addRoute('POST', '/sandboxes/:sandbox_id/pause', async (_req, res, params) => {
  const sbx = getSandboxOrThrow(params.sandbox_id);
  sbx.state = 'paused';
  sendJson(res, {});
});

// POST /sandboxes/:sandbox_id/snapshots — create snapshot
addRoute('POST', '/sandboxes/:sandbox_id/snapshots', async (_req, res, params) => {
  getSandboxOrThrow(params.sandbox_id);
  sendJson(res, {
    snapshot_id: `snap-${shortId()}`,
    sandbox_id: params.sandbox_id,
    created_at: new Date().toISOString(),
  });
});

// POST /sandboxes/:sandbox_id/commands — run command
addRoute('POST', '/sandboxes/:sandbox_id/commands', async (req, res, params) => {
  const sbx = getSandboxOrThrow(params.sandbox_id);
  const body = await parseJsonBody(req);
  const cmd = body.cmd as string;
  const background = (body.background as boolean) ?? false;
  const sandboxDir = getSandboxDir(params.sandbox_id);
  const envs = buildEnv(params.sandbox_id, sbx, body.envs as Record<string, string> | undefined);
  const cwd = (body.cwd as string) || sandboxDir;

  if (background) {
    const pid = nextPid();
    const procs = processes.get(params.sandbox_id)!;
    procs.set(pid, { cmd, envs, cwd, is_pty: false });
    sendJson(res, { pid });
    return;
  }

  try {
    const timeout = ((body.timeout as number) ?? 60) * 1000;
    const result = execSync(cmd, {
      timeout,
      env: envs,
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    sendJson(res, { stdout: result, stderr: '', exit_code: 0 });
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    sendJson(res, {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
      exit_code: e.status ?? 1,
    });
  }
});

// GET /sandboxes/:sandbox_id/commands — list commands
addRoute('GET', '/sandboxes/:sandbox_id/commands', async (_req, res, params) => {
  getSandboxOrThrow(params.sandbox_id);
  const procs = processes.get(params.sandbox_id) ?? new Map();
  const items: unknown[] = [];
  for (const [pid, p] of procs.entries()) {
    items.push({ pid, cmd: p.cmd, is_pty: p.is_pty, envs: {} });
  }
  sendJson(res, items);
});

// DELETE /sandboxes/:sandbox_id/commands/:pid — kill command
addRoute('DELETE', '/sandboxes/:sandbox_id/commands/:pid', async (_req, res, params) => {
  getSandboxOrThrow(params.sandbox_id);
  const procs = processes.get(params.sandbox_id) ?? new Map();
  const pid = parseInt(params.pid, 10);
  const killed = procs.has(pid);
  procs.delete(pid);
  sendJson(res, { killed });
});

// POST /sandboxes/:sandbox_id/commands/:pid/stdin — send stdin
addRoute('POST', '/sandboxes/:sandbox_id/commands/:pid/stdin', async (_req, res, params) => {
  getSandboxOrThrow(params.sandbox_id);
  sendJson(res, {});
});

// GET /sandboxes/:sandbox_id/commands/:pid/wait — wait for command
addRoute('GET', '/sandboxes/:sandbox_id/commands/:pid/wait', async (_req, res, params) => {
  const sbx = getSandboxOrThrow(params.sandbox_id);
  const procs = processes.get(params.sandbox_id) ?? new Map();
  const pid = parseInt(params.pid, 10);
  const procInfo = procs.get(pid);

  if (!procInfo) {
    sendJson(res, { stdout: '', stderr: 'process not found', exit_code: 1 });
    return;
  }

  const envs = buildEnv(params.sandbox_id, sbx, procInfo.envs);
  const cwd = procInfo.cwd || getSandboxDir(params.sandbox_id);

  try {
    const result = execSync(procInfo.cmd, {
      timeout: 60000,
      env: envs,
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    procs.delete(pid);
    sendJson(res, { stdout: result, stderr: '', exit_code: 0 });
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    procs.delete(pid);
    sendJson(res, {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
      exit_code: e.status ?? 1,
    });
  }
});

// POST /sandboxes/:sandbox_id/commands/stream — SSE streaming
addRoute('POST', '/sandboxes/:sandbox_id/commands/stream', async (req, res, params) => {
  const sbx = getSandboxOrThrow(params.sandbox_id);
  const body = await parseJsonBody(req);
  const cmd = body.cmd as string;
  const sandboxDir = getSandboxDir(params.sandbox_id);
  const envs = buildEnv(params.sandbox_id, sbx, body.envs as Record<string, string> | undefined);
  const cwd = (body.cwd as string) || sandboxDir;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    const timeout = ((body.timeout as number) ?? 60) * 1000;
    const result = execSync(cmd, {
      timeout,
      env: envs,
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result) {
      res.write(`data: ${JSON.stringify({ type: 'stdout', data: result })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ exit_code: 0 })}\n\n`);
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    if (e.stdout) {
      res.write(`data: ${JSON.stringify({ type: 'stdout', data: e.stdout })}\n\n`);
    }
    if (e.stderr) {
      res.write(`data: ${JSON.stringify({ type: 'stderr', data: e.stderr })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ exit_code: e.status ?? 1 })}\n\n`);
  }

  res.end();
});

// --- Filesystem routes ---

// GET /sandboxes/:sandbox_id/files — read file
addRoute('GET', '/sandboxes/:sandbox_id/files', async (_req, res, params, query) => {
  const base = getSandboxDir(params.sandbox_id);
  const filePath = query.get('path') ?? '';
  const full = path.join(base, filePath.replace(/^\//, ''));
  if (!fs.existsSync(full)) {
    send404(res, `File not found: ${filePath}`);
    return;
  }
  const content = fs.readFileSync(full, 'utf8');
  sendText(res, content);
});

// POST /sandboxes/:sandbox_id/files — write file
addRoute('POST', '/sandboxes/:sandbox_id/files', async (req, res, params) => {
  const base = getSandboxDir(params.sandbox_id);
  const body = await parseJsonBody(req);
  const filePath = body.path as string;
  const data = body.data as string;
  const full = path.join(base, filePath.replace(/^\//, ''));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data, 'utf8');
  sendJson(res, { path: filePath, size: data.length });
});

// POST /sandboxes/:sandbox_id/files/batch — batch write
addRoute('POST', '/sandboxes/:sandbox_id/files/batch', async (req, res, params) => {
  const base = getSandboxDir(params.sandbox_id);
  const body = await parseJsonBody(req);
  const files = body.files as Array<{ path: string; data: string }>;
  const results: Array<{ path: string; size: number }> = [];
  for (const entry of files) {
    const full = path.join(base, entry.path.replace(/^\//, ''));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, entry.data, 'utf8');
    results.push({ path: entry.path, size: entry.data.length });
  }
  sendJson(res, results);
});

// GET /sandboxes/:sandbox_id/files/list — list directory
addRoute('GET', '/sandboxes/:sandbox_id/files/list', async (_req, res, params, query) => {
  const base = getSandboxDir(params.sandbox_id);
  const dirPath = query.get('path') ?? '/';
  const full = path.join(base, dirPath.replace(/^\//, ''));
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
    sendJson(res, []);
    return;
  }
  const entries: unknown[] = [];
  for (const name of fs.readdirSync(full)) {
    const fp = path.join(full, name);
    const stat = fs.statSync(fp);
    entries.push({
      name,
      path: path.join(dirPath, name),
      type: stat.isDirectory() ? 'dir' : 'file',
      size: stat.isFile() ? stat.size : 0,
    });
  }
  sendJson(res, entries);
});

// GET /sandboxes/:sandbox_id/files/exists — check file exists
addRoute('GET', '/sandboxes/:sandbox_id/files/exists', async (_req, res, params, query) => {
  const base = getSandboxDir(params.sandbox_id);
  const filePath = query.get('path') ?? '';
  const full = path.join(base, filePath.replace(/^\//, ''));
  sendJson(res, { exists: fs.existsSync(full) });
});

// GET /sandboxes/:sandbox_id/files/info — file info
addRoute('GET', '/sandboxes/:sandbox_id/files/info', async (_req, res, params, query) => {
  const base = getSandboxDir(params.sandbox_id);
  const filePath = query.get('path') ?? '';
  const full = path.join(base, filePath.replace(/^\//, ''));
  if (!fs.existsSync(full)) {
    send404(res, 'Not found');
    return;
  }
  const stat = fs.statSync(full);
  sendJson(res, {
    name: path.basename(full),
    path: filePath,
    type: stat.isDirectory() ? 'dir' : 'file',
    size: stat.isFile() ? stat.size : 0,
  });
});

// DELETE /sandboxes/:sandbox_id/files — remove file
addRoute('DELETE', '/sandboxes/:sandbox_id/files', async (_req, res, params, query) => {
  const base = getSandboxDir(params.sandbox_id);
  const filePath = query.get('path') ?? '';
  const full = path.join(base, filePath.replace(/^\//, ''));
  if (fs.existsSync(full)) {
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      fs.rmSync(full, { recursive: true, force: true });
    } else {
      fs.unlinkSync(full);
    }
  }
  sendJson(res, {});
});

// PATCH /sandboxes/:sandbox_id/files — rename file
addRoute('PATCH', '/sandboxes/:sandbox_id/files', async (req, res, params) => {
  const base = getSandboxDir(params.sandbox_id);
  const body = await parseJsonBody(req);
  const oldPath = body.old_path as string;
  const newPath = body.new_path as string;
  const oldFull = path.join(base, oldPath.replace(/^\//, ''));
  const newFull = path.join(base, newPath.replace(/^\//, ''));
  fs.mkdirSync(path.dirname(newFull), { recursive: true });
  fs.renameSync(oldFull, newFull);
  const stat = fs.statSync(newFull);
  sendJson(res, {
    name: path.basename(newFull),
    path: newPath,
    type: stat.isDirectory() ? 'dir' : 'file',
    size: stat.isFile() ? stat.size : 0,
  });
});

// POST /sandboxes/:sandbox_id/files/mkdir — make directory
addRoute('POST', '/sandboxes/:sandbox_id/files/mkdir', async (req, res, params) => {
  const base = getSandboxDir(params.sandbox_id);
  const body = await parseJsonBody(req);
  const dirPath = body.path as string;
  const full = path.join(base, dirPath.replace(/^\//, ''));
  const created = !fs.existsSync(full);
  fs.mkdirSync(full, { recursive: true });
  sendJson(res, { created });
});

// POST /sandboxes/:sandbox_id/files/watch — watch (stub)
addRoute('POST', '/sandboxes/:sandbox_id/files/watch', async (_req, res, params) => {
  getSandboxOrThrow(params.sandbox_id);
  sendJson(res, {});
});

// --- Templates ---

// POST /templates/build — mock build
addRoute('POST', '/templates/build', async (req, res) => {
  const body = await parseJsonBody(req);
  const buildId = `build-${shortId()}`;
  const status = body.background ? 'building' : 'completed';
  sendJson(res, {
    build_id: buildId,
    status,
    template_id: `tpl-${(body.alias as string) ?? 'custom'}`,
    logs: ['Step 1: Building...', 'Step 2: Done.'],
  });
});

// GET /templates/builds/:build_id — mock build status
addRoute('GET', '/templates/builds/:build_id', async (_req, res, params) => {
  sendJson(res, {
    build_id: params.build_id,
    status: 'completed',
    logs: ['Done.'],
  });
});

// ---------------------------------------------------------------------------
// Server creation
// ---------------------------------------------------------------------------

export interface MockServer {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

export function startServer(port = 0): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const { pathname, query } = parseUrl(req.url ?? '/');
        const method = req.method ?? 'GET';

        const matched = matchRoute(method, pathname);
        if (!matched) {
          sendJson(res, { message: `Not found: ${method} ${pathname}` }, 404);
          return;
        }

        await matched.handler(req, res, matched.params, query);
      } catch (err: unknown) {
        const e = err as { status?: number; body?: unknown };
        if (e.status && e.body) {
          sendJson(res, e.body, e.status);
        } else {
          sendJson(res, { message: (err as Error).message ?? 'Internal server error' }, 500);
        }
      }
    });

    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }
      resolve({
        server,
        port: addr.port,
        close: () =>
          new Promise<void>((resolveClose) => {
            // Clean up temp dirs
            for (const dir of sandboxDirs.values()) {
              try {
                fs.rmSync(dir, { recursive: true, force: true });
              } catch {
                // ignore
              }
            }
            server.close(() => resolveClose());
          }),
      });
    });

    server.on('error', reject);
  });
}
