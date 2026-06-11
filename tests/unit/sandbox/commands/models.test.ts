import { describe, it, expect } from 'vitest';
import { parseCommandResult, parseProcessInfo } from '../../../../src/sandbox/commands/models.js';

describe('parseCommandResult', () => {
  it('parses snake_case keys', () => {
    const result = parseCommandResult({
      stdout: 'hello world',
      stderr: '',
      exit_code: 0,
    });
    expect(result.stdout).toBe('hello world');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('parses camelCase keys', () => {
    const result = parseCommandResult({
      stdout: 'out',
      stderr: 'err',
      exitCode: 1,
    });
    expect(result.exitCode).toBe(1);
  });

  it('uses defaults for missing fields', () => {
    const result = parseCommandResult({});
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });
});

describe('parseProcessInfo', () => {
  it('parses snake_case keys', () => {
    const info = parseProcessInfo({
      pid: 42,
      cmd: 'node index.js',
      is_pty: true,
      envs: { NODE_ENV: 'production' },
    });
    expect(info.pid).toBe(42);
    expect(info.cmd).toBe('node index.js');
    expect(info.isPty).toBe(true);
    expect(info.envs).toEqual({ NODE_ENV: 'production' });
  });

  it('parses camelCase keys', () => {
    const info = parseProcessInfo({ pid: 1, cmd: 'ls', isPty: false, envs: {} });
    expect(info.isPty).toBe(false);
  });

  it('uses defaults for missing fields', () => {
    const info = parseProcessInfo({});
    expect(info.pid).toBe(0);
    expect(info.cmd).toBe('');
    expect(info.isPty).toBe(false);
    expect(info.envs).toEqual({});
  });
});
