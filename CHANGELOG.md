# Changelog

All notable changes to the Declaw TypeScript / JavaScript SDK are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.3]

_Restore the conservative default connection ceiling._

### Changed

- Reverted the default connection-pool ceiling back to 64 (from the 512
  introduced in 1.2.2). High-concurrency workloads should opt in explicitly
  via `DECLAW_SDK_CONNECTIONS`. No public API change.

## [1.2.2]

_Higher default connection ceiling._

### Performance

- Raised the default connection-pool ceiling from 64 to 512 so a
  high-concurrency workload from a single client process is no longer queued
  behind the connection cap. Still overridable via `DECLAW_SDK_CONNECTIONS`.
  No public API change.

## [1.2.1]

_HTTP/2 burst performance._

### Performance

- Unblocked HTTP/2 multiplexing on burst create: removed `pipelining: 1`
  from the undici Agent, which was capping each H2 connection to a single
  in-flight stream and silently defeating `allowH2` — a 100-concurrent burst
  queued ~36 requests behind the connection cap. Also: eagerly initialize the
  undici dispatcher at module load (the lazy `import('undici')` was blocking
  the first burst), cache the resolved dispatcher synchronously (skips a
  per-request microtask yield), and lower the retry backoff base from 0.5s to
  0.1s. No public API change (#359).

## [1.2.0]

_2026-06 train: file-granular volumes, OPA governance._

### Added

- Mode-based volumes: write-back and mount modes with a file-granular
  backend, plus a detached volume-files API — `volume.files.write()` /
  `read()` / `list()` / `info()` / `exists()` / `remove()` / `rename()` /
  `mkdir()`, `volumes.empty()` and `volumes.ingest()` constructors, and
  volume locks (`acquire` / `renew` / `release` / `status`) (#344).
- OPA custom-policy support for AI agents: custom policy config with
  `policyRef` resolution, `contentGate` for model/domain gating, and
  out-of-box AI governance packs (#279, #345).

### Changed

- The per-sandbox audit flag now gates network, command, and filesystem
  event categories: `enabled: false` suppresses all gated categories
  while lifecycle and admin events are still recorded (#332).

## [1.1.13]

### Changed

- `DECLAW_SDK_CONNECTIONS` default lowered from 100 to **64**, matching
  the 1.1.10 baseline. Empirically faster on typical low-to-mid
  concurrency workloads (~10% lower median TTI in our 3-mode bench at
  100 concurrent) because the smaller pool pays less TCP-setup overhead
  on cold start. `DECLAW_SDK_MAX_CONCURRENT_STREAMS` default remains
  **1000** (introduced in 1.1.12) so the effective in-flight ceiling is
  **64,000 concurrent requests** per Node process — well above any
  realistic burst load. Raise `DECLAW_SDK_CONNECTIONS=100` to lift the
  ceiling to 100,000 if you need it.

## [1.1.12]

### Changed

- `DECLAW_SDK_CONNECTIONS` default lowered from 256 to **100**. Combined
  with the existing `DECLAW_SDK_MAX_CONCURRENT_STREAMS=1000` default,
  this gives an effective in-flight ceiling of **100,000 concurrent
  requests** per Node process (vs 256,000 in 1.1.11). The lower default
  reduces idle TCP socket count and keeps the per-connection stream
  count well clear of the server's advertised
  `SETTINGS_MAX_CONCURRENT_STREAMS=4096`. Both knobs remain
  configurable via env vars for callers that need higher or lower caps.

## [1.1.11]

### Added

- `sandbox.stdio.start(cmd)` — native interactive stdio for sandboxed
  processes. Returns a `StdioProcess` handle with `sendStdin()`,
  `closeStdin()`, `stream()`, `kill()`, and `wait()`. Supports
  callbacks (`onStdout`, `onStderr`) and async iteration.
- `sandbox.getHost(port)` — inbound HTTP port proxy URL for accessing
  services running inside the sandbox.
- `sandbox.getMcpUrl()` — convenience URL for MCP servers on port 50005.

## [1.1.8]

### Documentation

- README clarifies `files.write` path semantics: `path` is the literal
  absolute path inside the sandbox — no remapping, no bridge directory,
  no prefix.

## [1.1.7]

### Added

- `Sandbox.kill(id)` static — kill by id in one HTTP call.

## [1.1.6]

### Added

- `Sandbox.killMany(ids)` — bulk teardown in one request.

### Changed

- `sandbox.kill()` returns once the kill is accepted; pass
  `{ wait: true }` to block until teardown finishes.
- Bump `undici` optional dep to `^7.0.0` (removes the experimental
  `UNDICI-H2` warning). Minimum Node is now 20.18.1.

## [1.1.5]

### Changed

- Set Node dispatcher pool size to 64 (overridable via
  `DECLAW_SDK_CONNECTIONS`).

## [1.1.4]

### Changed

- Enable HTTP/2 multiplexing on the Node dispatcher (`allowH2: true`).

## [1.1.3]

### Changed

- **Higher-concurrency HTTP dispatcher on Node.** The SDK now installs a
  module-level `undici.Agent` (128 connections per origin, keep-alive
  tuned) on first use under Node, so callers fanning out many concurrent
  requests are no longer capped by undici's default 10 connections per
  origin. On runtimes that don't ship `undici` (browsers, Cloudflare
  Workers, Deno) the dynamic import silently no-ops and the platform's
  native `fetch` is used unchanged. Opt out with
  `DECLAW_SDK_DISABLE_DISPATCHER=1` if you bring your own dispatcher.
  `undici` is declared as an `optionalDependency`.

## [1.1.2]

### Fixed

- **Binary-safe `files.read`.** `sandbox.files.read(path, { format: "bytes" })`
  now returns a `Uint8Array` with the raw bytes. Previously the
  `format` option was silently ignored: every read went through the
  `text/plain` accept path and was UTF-8 decoded, so any byte with the
  high bit set collapsed to the replacement character `U+FFFD` and the
  buffer came back short of the real file length. Binary writes were
  already routed through `PUT /files/raw` (1.0.1); this patch closes
  the read side so PNGs, compressed archives, and other non-text blobs
  round-trip unmodified.

## [1.1.1]

### Changed

- **Process-wide HTTP client cache.** `Sandbox.create` / `.connect` /
  `.list`, `Volumes.*`, and `Template.*` now share a single `ApiClient`
  per `(apiKey, apiUrl, requestTimeout)` via the new `getSharedClient`
  helper instead of constructing a fresh instance per call. Matches the
  symmetry added on the Python side and removes unnecessary
  `AbortController` churn. Node's global fetch / undici dispatcher was
  already pooling TCP + TLS under the hood, so end-to-end latency is
  unchanged for most callers — the user-visible win is that
  `close()` on a returned `Sandbox` is now a no-op rather than
  aborting an in-flight request on the shared client.
- New exports from the package root: `getSharedClient`,
  `resetSharedClients`. Use `resetSharedClients()` from tests or
  long-running services that want to force a full teardown.
- `Sandbox.close()` is now a no-op. `Sandbox.kill()` still kills the
  VM and is unchanged.

## [1.1.0]

### Added

- **Volumes API.** Upload a tarball once, attach it to one or many
  sandboxes at create time. The server streams the blob from object
  storage into each sandbox's overlay filesystem at boot — so N
  parallel sandboxes share a dataset without N uploads.
  - New `Volumes` class with static `create` / `get` / `list` /
    `delete` methods. Body is a `Uint8Array` or `ArrayBuffer`;
    streams end-to-end with no in-memory buffering on the server.
  - New types: `VolumeInfo`, `VolumeAttachment`, `VolumeCreateOpts`,
    `VolumeRequestOpts` — exported from the package root.
  - `SandboxOpts.volumes?: VolumeAttachment[]` on `Sandbox.create` —
    each attachment is `{ volumeId, mountPath }`. Multiple sandboxes
    can attach the same `volumeId` in parallel.
  - Helper functions `parseVolumeInfo` (wire → shape) and
    `volumeAttachmentToJSON` (shape → wire).
  - Phase 1 limits: upload body capped at 4 GiB; format must be
    `application/gzip` (tar.gz); volumes are read-at-boot (sandbox
    writes do not flow back). Symlinks, hardlinks, device nodes, and
    entries containing `..` are dropped server-side for safety.

## [1.0.4]

### Changed

- `InjectionAction` — dropped the `"sanitize"` value. The server
  never implemented request-body sanitization for detected injections
  (the classifier returns a whole-request verdict, not span offsets),
  so the value was accepted client-side but silently behaved like
  `log_only` at the edge proxy. Valid values are now `"block"` and
  `"log_only"`. Default action changes from `"sanitize"` to
  `"log_only"` so existing enforcement behaviour is preserved.
  Callers passing `action: "sanitize"` will now raise at construction
  time; migrate to `"log_only"` (same behaviour) or `"block"`
  (hard-reject on detection).

## [1.0.3]

### Added

- `sandbox.pty.connect(pid, { onData })` — reattach a fresh data callback
  to an already-running PTY session by pid. Multiple clients can
  subscribe concurrently; each receives output from the moment it
  connects (no scrollback replay).
- Server-side PTY session TTL. The `timeout` option on
  `sandbox.pty.create()` is now enforced inside the sandbox — the PTY
  is terminated when the deadline elapses, even if no client is
  attached. `timeout: 0` keeps it alive indefinitely.

### Changed

- `PtyHandle.wait()` now resolves with a `PtyResult` object (`{ exitCode }`)
  instead of a bare number. This matches the shape of other lifecycle
  APIs and leaves room for future fields (e.g. signal). Existing
  numeric access becomes `(await handle.wait()).exitCode`.

## [1.0.2]

### Added

- Real interactive PTY support. `sandbox.pty.create()` now returns a
  `PtyHandle` with both an `onData` callback and an `async *stream()`
  iterator that deliver raw terminal bytes as they arrive from the
  sandbox (ANSI escapes included).
- `PtyHandle.sendInput`, `PtyHandle.resize`, `PtyHandle.kill`,
  `PtyHandle.disconnect`, `PtyHandle.wait()` for full lifecycle control.
- `ApiClient.streamGet()` for SSE consumers.
- `PtyHandle` exported from the package root.

### Changed

- `Pty.create()` accepts `onData` in `PtyCreateOpts` and returns the new
  `PtyHandle` type. Existing fields are unchanged; callers that only
  used the returned handle for `sendInput`/`resize`/`kill` continue to
  work without edits.

## [1.0.0]

First stable release. The public API described below is covered by
semantic versioning going forward: breaking changes require a major
version bump.

### Added

#### Sandbox lifecycle
- `Sandbox.create(opts)` spins up a Firecracker microVM from a template
  in ~sub-second and returns a handle scoped to the caller's account.
- `sandbox.kill()`, `sandbox.pause()`, `sandbox.resume()` for explicit
  lifecycle control; auto-cleanup via the `timeout` option.
- `Sandbox.list()` and `SandboxPaginator` for enumerating live
  sandboxes with pagination.
- `sandbox.snapshot()` / `sandbox.restore()` with `Snapshot` and
  `SnapshotInfo` types; `SnapshotPaginator` for listing.
- `SandboxInfo`, `SandboxState`, `SandboxLifecycle`, `SandboxMetrics`,
  `SandboxQuery` types + parsers.

#### Commands
- `sandbox.commands.run(cmd, opts)` for one-shot execution returning
  `CommandResult`.
- `sandbox.commands.runStream(cmd, opts)` for incremental `Stdout` /
  `Stderr` events.
- `CommandHandle` for long-running processes: `wait()`, `kill()`,
  stdin piping, PTY resize.
- `sandbox.pty.*` for interactive PTY sessions with `PtySize` /
  `PtyOutput`.
- `ProcessInfo` type and `sandbox.commands.list()` for inspecting live
  processes.

#### Filesystem
- `sandbox.files.read()`, `sandbox.files.write()`, `sandbox.files.list()`,
  `sandbox.files.exists()`, `sandbox.files.info()`, `sandbox.files.remove()`,
  `sandbox.files.rename()`, `sandbox.files.mkdir()`.
- Streaming large uploads/downloads via `files.writeRaw()` /
  `files.readRaw()` (500 MiB request cap).
- Batch writes via `files.writeBatch()` accepting `WriteEntry[]`.
- Live directory watching via `sandbox.files.watch()` returning a
  `WatchHandle` with a `FilesystemEvent` stream.
- `EntryInfo`, `WriteInfo`, `FileType`, `FilesystemEventType` types.

#### Templates
- `Template` for defining custom rootfs images from a `TemplateBase`,
  `CopyItem[]`, pip/apt installs, and run commands.
- `template.build()` triggers a Firecracker rootfs build; `BuildInfo`
  surfaces build progress.

#### Security policy
Declaw's differentiating surface — opt-in per-sandbox via the
`security` option on `Sandbox.create()`.

- **PII redaction** (`PIIConfig`, `PIIType`, `RedactionAction`): the
  security proxy redacts PII before outbound traffic leaves the VM and
  can rehydrate on the inbound response (`rehydrateResponse: true`).
- **Prompt injection defense** (`InjectionDefenseConfig`).
- **Network policy** (`NetworkPolicy`, `ALL_TRAFFIC`): allow/deny
  egress by domain with wildcard + regex matchers. Cloud metadata IPs
  (`169.254.169.254`) blocked by default.
- **Toxicity scanner** (`ToxicityConfig`).
- **Code security scanner** (`CodeSecurityConfig`).
- **Invisible text scanner** (`InvisibleTextConfig`).
- **Transformation rules** (`TransformationRule`, `TransformDirection`)
  for regex-based inbound/outbound content rewriting.
- **Audit logging** (`AuditConfig`, `AuditEntry`) returns per-sandbox
  audit records.
- **Secure env vars** (`SecureEnvVar`, `EnvSecurityConfig`).

#### Errors
Typed error hierarchy — every error subclasses `SandboxError`:
- `AuthenticationError`, `InvalidArgumentError`, `NotFoundError`,
  `TimeoutError`, `CommandExitError`, `NotEnoughSpaceError`,
  `TemplateError`, `BuildError`, `FileUploadError`, `GitAuthError`,
  `GitUpstreamError`.

#### API client
- `ApiClient` for advanced users who want to bypass the high-level
  `Sandbox` facade and call the control-plane REST API directly.
- `ConnectionConfig` centralizes `DECLAW_API_KEY`, `DECLAW_DOMAIN`,
  timeouts, and debug mode; every field is overridable at
  `Sandbox.create()`.

### Packaging
- Ships both ESM (`import`) and CJS (`require`) entry points with
  matching `.d.ts` / `.d.cts` type files (built with `tsup`).
- Requires **Node.js `>=18.0.0`**.
- Zero runtime dependencies besides `eventsource-parser` (SSE stream
  decoding).
