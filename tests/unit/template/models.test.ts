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

  it('supports fluent API', () => {
    const tmpl = new TemplateBase()
      .fromBaseImage('node:20')
      .aptInstall('curl', 'git')
      .runCmd(['npm', 'install'])
      .copy('/local/app', '/app', 0o755)
      .setEnvs({ NODE_ENV: 'production' })
      .setStartCmd('node /app/index.js');

    const json = tmpl.toJSON();
    expect(json.base_image).toBe('node:20');
    expect(json.apt_packages).toEqual(['curl', 'git']);
    // run_cmds are serialized as space-joined shell lines per fix #233
    expect(json.run_cmds).toEqual(['npm install']);
    expect(json.copies).toEqual([{ src: '/local/app', dst: '/app', mode: 0o755 }]);
    expect(json.envs).toEqual({ NODE_ENV: 'production' });
    expect(json.start_cmd).toBe('node /app/index.js');
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
    expect(json).not.toHaveProperty('apt_packages');
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
    expect(json.apt_packages).toEqual(['curl', 'wget', 'git']);
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
});
