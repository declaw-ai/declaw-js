// API Client
export { ApiClient, getSharedClient, resetSharedClients } from './api/client.js';
export type { RequestOpts } from './api/client.js';

// Sandbox
export { Sandbox } from './sandbox/sandbox.js';
export type { SandboxOpts } from './sandbox/sandbox.js';

// Errors
export {
  SandboxError,
  TimeoutError,
  NotFoundError,
  AuthenticationError,
  InvalidArgumentError,
  NotEnoughSpaceError,
  ConflictError,
  TemplateError,
  BuildError,
  FileUploadError,
  GitAuthError,
  GitUpstreamError,
  CommandExitError,
} from './errors.js';

// Connection config
export { ConnectionConfig } from './connectionConfig.js';
export type { ConnectionConfigOptions } from './connectionConfig.js';

// Sandbox models
export {
  SandboxState,
  parseSandboxInfo,
  parseSandboxMetrics,
  parseSandboxLifecycle,
  parseSnapshotInfo,
  parseSnapshot,
} from './sandbox/models.js';
export type {
  SandboxInfo,
  SandboxMetrics,
  SandboxQuery,
  SandboxLifecycle,
  SnapshotInfo,
  Snapshot,
  SnapshotSource,
} from './sandbox/models.js';

// Commands
export { Commands } from './sandbox/commands/commands.js';
export type { RunOpts, RunStreamOpts } from './sandbox/commands/commands.js';
export { CommandHandle } from './sandbox/commands/commandHandle.js';
export type { CommandWaitOpts } from './sandbox/commands/commandHandle.js';

// Command models
export { parseCommandResult, parseProcessInfo } from './sandbox/commands/models.js';
export type {
  CommandResult,
  ProcessInfo,
  PtySize,
  PtyOutput,
  Stdout,
  Stderr,
} from './sandbox/commands/models.js';

// Filesystem
export { Filesystem } from './sandbox/filesystem/filesystem.js';
export { WatchHandle } from './sandbox/filesystem/watchHandle.js';

// Filesystem models
export {
  FileType,
  FilesystemEventType,
  parseEntryInfo,
  parseWriteInfo,
  parseFilesystemEvent,
} from './sandbox/filesystem/models.js';
export type {
  EntryInfo,
  WriteInfo,
  WriteEntry,
  FilesystemEvent,
} from './sandbox/filesystem/models.js';

// Network
export { ALL_TRAFFIC, validateNetworkEntry, domainMatches } from './sandbox/network.js';
export type { SandboxNetworkOpts } from './sandbox/network.js';

// Security - PII
export { PIIType, RedactionAction, createPIIConfig, parsePIIConfig } from './security/pii.js';
export type { PIIConfig } from './security/pii.js';

// Security - Injection
export {
  InjectionSensitivity,
  InjectionAction,
  createInjectionDefenseConfig,
  parseInjectionDefenseConfig,
} from './security/injection.js';
export type { InjectionDefenseConfig, InjectionJudgeConfig } from './security/injection.js';

// Security - Audit
export { createAuditConfig, parseAuditConfig, parseAuditEntry } from './security/audit.js';
export type { AuditConfig, AuditEntry } from './security/audit.js';

// Security - Env
export {
  DEFAULT_MASK_PATTERNS,
  createEnvSecurityConfig,
  parseEnvSecurityConfig,
  isSensitive,
} from './security/env.js';
export type { EnvSecurityConfig, SecureEnvVar } from './security/env.js';

// Security - Transformations
export {
  TransformDirection,
  createTransformationRule,
  applyTransformation,
} from './security/transformations.js';
export type { TransformationRule } from './security/transformations.js';

// Security - Network Policy
export {
  createNetworkPolicy,
  parseNetworkPolicy,
  networkPolicyToOpts,
} from './security/networkPolicy.js';
export type { NetworkPolicy } from './security/networkPolicy.js';

// Security - Toxicity
export {
  createToxicityConfig,
  parseToxicityConfig,
  toxicityConfigToJSON,
} from './security/toxicity.js';
export type { ToxicityConfig } from './security/toxicity.js';

// Security - Code Security
export {
  createCodeSecurityConfig,
  parseCodeSecurityConfig,
  codeSecurityConfigToJSON,
} from './security/codeSecurity.js';
export type { CodeSecurityConfig } from './security/codeSecurity.js';

// Security - Invisible Text
export {
  createInvisibleTextConfig,
  parseInvisibleTextConfig,
  invisibleTextConfigToJSON,
} from './security/invisibleText.js';
export type { InvisibleTextConfig } from './security/invisibleText.js';

// Security - Content Gate
export {
  createContentGateConfig,
  parseContentGateConfig,
  contentGateConfigToJSON,
} from './security/contentGate.js';
export type { ContentGateConfig } from './security/contentGate.js';

// Security - Policy
export {
  createSecurityPolicy,
  fullInjectionDefensePolicy,
  parseSecurityPolicy,
  securityPolicyToJSON,
  requiresTlsInterception,
} from './security/policy.js';
export type { SecurityPolicy, FullInjectionDefenseOptions } from './security/policy.js';

// PTY
export { Pty, PtyHandle } from './sandbox/pty/pty.js';
export type { PtyCreateOpts, PtyConnectOpts, PtyResult } from './sandbox/pty/pty.js';

// Stdio
export { Stdio, StdioProcess } from './sandbox/stdio/stdio.js';
export type { StdioStartOpts, StdioResult } from './sandbox/stdio/stdio.js';

// Paginators
export { SandboxPaginator, SnapshotPaginator } from './paginator.js';

// Template
export { Template } from './template/template.js';
export type { TemplateBuildOpts, GetBuildStatusOpts } from './template/template.js';

// Template models
export { TemplateBase, parseBuildInfo, parseTemplateBuildStatus } from './template/models.js';
export type { CopyItem, BuildInfo, TemplateBuildStatus } from './template/models.js';

// Volumes
export { Volumes } from './volumes/volumes.js';
export type { VolumeCreateOpts } from './volumes/volumes.js';
export type { VolumeRequestOpts } from './volumes/types.js';
export { VolumeFiles } from './volumes/files.js';
export type { VolumeWriteOpts, VolumeRemoveOpts } from './volumes/files.js';
export { VolumeLocks } from './volumes/locks.js';
export {
  parseVolumeInfo,
  parseFileEntry,
  parseFileInfo,
  parseLockLease,
  parseLockStatus,
  volumeAttachmentToJSON,
} from './volumes/models.js';
export type {
  VolumeInfo,
  VolumeAttachment,
  VolumeAttachMode,
  FileEntry,
  FileInfo,
  LockLease,
  LockStatus,
} from './volumes/models.js';

// Governance
export { Governance } from './governance/governance.js';
export type { GovernanceRequestOpts } from './governance/governance.js';
export { parseGovernancePack } from './governance/models.js';
export type { GovernancePack, GovernanceControl, GovernanceAdvisory } from './governance/models.js';
