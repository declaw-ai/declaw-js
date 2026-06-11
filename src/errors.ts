/**
 * Base error for all sandbox-related errors.
 */
export class SandboxError extends Error {
  sandboxId?: string;

  constructor(message: string, opts?: { sandboxId?: string }) {
    super(message);
    this.name = 'SandboxError';
    this.sandboxId = opts?.sandboxId;
  }
}

/** Thrown when an operation exceeds its timeout. */
export class TimeoutError extends SandboxError {
  constructor(message: string, opts?: { sandboxId?: string }) {
    super(message, opts);
    this.name = 'TimeoutError';
  }
}

/** Thrown when a sandbox or resource is not found. */
export class NotFoundError extends SandboxError {
  constructor(message: string, opts?: { sandboxId?: string }) {
    super(message, opts);
    this.name = 'NotFoundError';
  }
}

/** Thrown when authentication fails. */
export class AuthenticationError extends SandboxError {
  constructor(message: string, opts?: { sandboxId?: string }) {
    super(message, opts);
    this.name = 'AuthenticationError';
  }
}

/** Thrown when an argument is invalid. */
export class InvalidArgumentError extends SandboxError {
  constructor(message: string, opts?: { sandboxId?: string }) {
    super(message, opts);
    this.name = 'InvalidArgumentError';
  }
}

/** Thrown when there is not enough disk space. */
export class NotEnoughSpaceError extends SandboxError {
  constructor(message: string, opts?: { sandboxId?: string }) {
    super(message, opts);
    this.name = 'NotEnoughSpaceError';
  }
}

/**
 * Thrown on an HTTP 409 conflict.
 *
 * For volume file writes this signals a CAS (compare-and-swap) version
 * mismatch — the file changed since the `if_version` token was read. For
 * volume locks it signals the lock is already held by another holder (on
 * acquire) or that the caller is not the current holder (on release/renew).
 * Catch this to re-read and retry.
 */
export class ConflictError extends SandboxError {
  constructor(message: string, opts?: { sandboxId?: string }) {
    super(message, opts);
    this.name = 'ConflictError';
  }
}

/** Thrown for template-related errors. */
export class TemplateError extends SandboxError {
  constructor(message: string, opts?: { sandboxId?: string }) {
    super(message, opts);
    this.name = 'TemplateError';
  }
}

/** Thrown when a template build fails. */
export class BuildError extends TemplateError {
  constructor(message: string, opts?: { sandboxId?: string }) {
    super(message, opts);
    this.name = 'BuildError';
  }
}

/** Thrown when a file upload fails. */
export class FileUploadError extends SandboxError {
  constructor(message: string, opts?: { sandboxId?: string }) {
    super(message, opts);
    this.name = 'FileUploadError';
  }
}

/** Thrown when git authentication fails inside a sandbox. */
export class GitAuthError extends SandboxError {
  constructor(message: string, opts?: { sandboxId?: string }) {
    super(message, opts);
    this.name = 'GitAuthError';
  }
}

/** Thrown when a git upstream operation fails. */
export class GitUpstreamError extends SandboxError {
  constructor(message: string, opts?: { sandboxId?: string }) {
    super(message, opts);
    this.name = 'GitUpstreamError';
  }
}

/** Thrown when a command exits with a non-zero exit code. */
export class CommandExitError extends SandboxError {
  exitCode: number;
  stdout: string;
  stderr: string;

  constructor(
    message: string,
    opts: { sandboxId?: string; exitCode: number; stdout: string; stderr: string },
  ) {
    super(message, { sandboxId: opts.sandboxId });
    this.name = 'CommandExitError';
    this.exitCode = opts.exitCode;
    this.stdout = opts.stdout;
    this.stderr = opts.stderr;
  }
}
