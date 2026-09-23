import { describe, it, expect } from 'vitest';
import {
  TemplateBase,
  parseBuildInfo,
  parseTemplateBuildStatus,
} from '../../../src/template/models.js';

describe('TemplateBase', () => {
  it('creates with default base image', () => {
    const tmpl = new TemplateBase();
    const json = tmpl.toJSON();
    expect(json.base_image).toBe('ubuntu:22.04');
  });

  it('supports fluent API and serializes with the server field names', () => {
    const tmpl = new TemplateBase()
      .fromBaseImage('node:20')
      .aptInstall('curl', 'git')
      .runCmd(['npm', 'install'])
      .setEnvs({ NODE_ENV: 'production' })
      .setStartCmd('node /app/index.js');

    // Exactly the server's names: it silently ignores any other field, so
    // "apt_packages" once installed nothing. run_cmds are space-joined shell
    // lines per fix #233.
    expect(tmpl.toJSON()).toEqual({
      base_image: 'node:20',
      packages: ['curl', 'git'],
      run_cmds: ['npm install'],
      envs: { NODE_ENV: 'production' },
      start_cmd: 'node /app/index.js',
    });
  });

  it('records copy() but never serializes it', () => {
    const tmpl = new TemplateBase().copy('/local/app', '/app', 0o755);
    expect(tmpl.hasCopies()).toBe(true);
    expect(tmpl.toJSON()).toEqual({ base_image: 'ubuntu:22.04' });
    expect(new TemplateBase().hasCopies()).toBe(false);
  });

  it('returns this from each method for chaining', () => {
    const tmpl = new TemplateBase();
    expect(tmpl.fromBaseImage()).toBe(tmpl);
    expect(tmpl.runCmd(['echo', 'hi'])).toBe(tmpl);
    expect(tmpl.copy('a', 'b')).toBe(tmpl);
    expect(tmpl.setEnvs({})).toBe(tmpl);
    expect(tmpl.aptInstall('vim')).toBe(tmpl);
    expect(tmpl.setStartCmd('bash')).toBe(tmpl);
  });

  it('omits empty arrays and undefined from JSON', () => {
    const tmpl = new TemplateBase();
    const json = tmpl.toJSON();
    expect(json).not.toHaveProperty('run_cmds');
    expect(json).not.toHaveProperty('copies');
    expect(json).not.toHaveProperty('envs');
    expect(json).not.toHaveProperty('packages');
    expect(json).not.toHaveProperty('start_cmd');
  });

  it('accumulates multiple runCmd calls', () => {
    const tmpl = new TemplateBase().runCmd(['apt', 'update']).runCmd(['apt', 'install', '-y', 'vim']);
    const json = tmpl.toJSON();
    expect(json.run_cmds).toHaveLength(2);
  });

  it('merges envs from multiple setEnvs calls', () => {
    const tmpl = new TemplateBase()
      .setEnvs({ A: '1' })
      .setEnvs({ B: '2' });
    const json = tmpl.toJSON();
    expect(json.envs).toEqual({ A: '1', B: '2' });
  });

  it('accumulates apt packages', () => {
    const tmpl = new TemplateBase().aptInstall('curl').aptInstall('wget', 'git');
    const json = tmpl.toJSON();
    expect(json.packages).toEqual(['curl', 'wget', 'git']);
  });

  it('fromBaseImage defaults to ubuntu:22.04 when called with undefined', () => {
    const tmpl = new TemplateBase().fromBaseImage('node:18').fromBaseImage();
    expect(tmpl.toJSON().base_image).toBe('ubuntu:22.04');
  });
});

describe('parseBuildInfo', () => {
  it('parses snake_case keys', () => {
    const info = parseBuildInfo({
      build_id: 'bld-1',
      status: 'building',
      template_id: 'tmpl-1',
    });
    expect(info.buildId).toBe('bld-1');
    expect(info.status).toBe('building');
    expect(info.templateId).toBe('tmpl-1');
    expect(info.logs).toEqual([]);
  });

  it('handles missing templateId', () => {
    const info = parseBuildInfo({ build_id: 'bld-2', status: 'queued' });
    expect(info.templateId).toBeUndefined();
  });

  it('uses defaults for missing fields', () => {
    const info = parseBuildInfo({});
    expect(info.buildId).toBe('');
    expect(info.status).toBe('');
  });
});

describe('parseTemplateBuildStatus', () => {
  it('parses snake_case keys', () => {
    const status = parseTemplateBuildStatus({
      build_id: 'bld-1',
      status: 'complete',
      logs: ['Step 1/5', 'Step 2/5'],
    });
    expect(status.buildId).toBe('bld-1');
    expect(status.status).toBe('complete');
    expect(status.logs).toEqual(['Step 1/5', 'Step 2/5']);
  });

  it('defaults logs to empty array', () => {
    const status = parseTemplateBuildStatus({ build_id: 'bld-3', status: 'failed' });
    expect(status.logs).toEqual([]);
  });

  it('treats null logs as none (a build with no output yet)', () => {
    const status = parseTemplateBuildStatus({ build_id: 'bld-4', status: 'building', logs: null });
    expect(status.logs).toEqual([]);
  });
});
