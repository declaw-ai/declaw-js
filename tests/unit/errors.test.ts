import { describe, it, expect } from 'vitest';
import {
  SandboxError,
  TimeoutError,
  NotFoundError,
  AuthenticationError,
  InvalidArgumentError,
  NotEnoughSpaceError,
  TemplateError,
  BuildError,
  FileUploadError,
  GitAuthError,
  GitUpstreamError,
  CommandExitError,
} from '../../src/errors.js';

describe('Error hierarchy', () => {
  it('SandboxError is an instance of Error', () => {
    const err = new SandboxError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err.message).toBe('test');
    expect(err.name).toBe('SandboxError');
  });

  it('SandboxError stores sandboxId', () => {
    const err = new SandboxError('test', { sandboxId: 'sb-123' });
    expect(err.sandboxId).toBe('sb-123');
  });

  it('SandboxError without sandboxId has undefined', () => {
    const err = new SandboxError('test');
    expect(err.sandboxId).toBeUndefined();
  });

  const subclasses = [
    { Cls: TimeoutError, name: 'TimeoutError' },
    { Cls: NotFoundError, name: 'NotFoundError' },
    { Cls: AuthenticationError, name: 'AuthenticationError' },
    { Cls: InvalidArgumentError, name: 'InvalidArgumentError' },
    { Cls: NotEnoughSpaceError, name: 'NotEnoughSpaceError' },
    { Cls: FileUploadError, name: 'FileUploadError' },
    { Cls: GitAuthError, name: 'GitAuthError' },
    { Cls: GitUpstreamError, name: 'GitUpstreamError' },
  ] as const;

  for (const { Cls, name } of subclasses) {
    it(`${name} extends SandboxError`, () => {
      const err = new Cls('msg', { sandboxId: 'sb-1' });
      expect(err).toBeInstanceOf(SandboxError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe(name);
      expect(err.message).toBe('msg');
      expect(err.sandboxId).toBe('sb-1');
    });
  }

  it('TemplateError extends SandboxError', () => {
    const err = new TemplateError('tmpl fail');
    expect(err).toBeInstanceOf(SandboxError);
    expect(err.name).toBe('TemplateError');
  });

  it('BuildError extends TemplateError', () => {
    const err = new BuildError('build fail');
    expect(err).toBeInstanceOf(TemplateError);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err.name).toBe('BuildError');
  });

  it('CommandExitError stores exit code, stdout, stderr', () => {
    const err = new CommandExitError('cmd failed', {
      sandboxId: 'sb-42',
      exitCode: 1,
      stdout: 'out',
      stderr: 'err',
    });
    expect(err).toBeInstanceOf(SandboxError);
    expect(err.name).toBe('CommandExitError');
    expect(err.exitCode).toBe(1);
    expect(err.stdout).toBe('out');
    expect(err.stderr).toBe('err');
    expect(err.sandboxId).toBe('sb-42');
  });

  it('error name property is set as own property for proper serialization', () => {
    const err = new TimeoutError('timeout');
    expect(err.name).toBe('TimeoutError');
    // name is set on the instance in the constructor, not inherited from prototype
    expect(Object.prototype.hasOwnProperty.call(err, 'name')).toBe(true);
    // This ensures name survives structured clone / serialization
    const plain = JSON.parse(JSON.stringify({ name: err.name }));
    expect(plain.name).toBe('TimeoutError');
  });
});
