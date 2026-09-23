import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { LogCursor, Template, buildPolling } from '../../../src/template/template.js';
import { TemplateBase } from '../../../src/template/models.js';
import {
  BuildError,
  InvalidArgumentError,
  NotFoundError,
  SandboxError,
  TimeoutError,
} from '../../../src/errors.js';

const BASE_URL = 'http://localhost:9999';
const OPTS = { domain: 'localhost:9999', apiKey: 'test-key' };

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  // Real builds are polled every few seconds; the tests only need the loop.
  buildPolling.intervalMs = 0;
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeTemplate(): TemplateBase {
  return new TemplateBase()
    .fromBaseImage('ubuntu:22.04')
    .aptInstall('curl', 'git')
    .runCmd(['echo', 'hello']);
}

function buildStatus(status: string, logs: string[] | null) {
  return { build_id: 'bld-1', status, template_id: 'tpl-1', logs };
}

/**
 * Mock the two build endpoints the way sandbox-manager answers them: starting a
 * build returns 201 "building" with no logs, and each status poll answers the
 * next entry of `statuses`. The list is finite on purpose — a loop that never
 * stops polling runs out of answers and fails instead of hanging.
 */
function mockBuild(statuses: ReturnType<typeof buildStatus>[]) {
  const calls = { bodies: [] as Record<string, unknown>[], polls: 0 };
  server.use(
    http.post(`${BASE_URL}/templates/build`, async ({ request }) => {
      calls.bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(
        { build_id: 'bld-1', status: 'building', template_id: 'tpl-1' },
        { status: 201 },
      );
    }),
    http.get(`${BASE_URL}/templates/builds/bld-1`, () => {
      const next = statuses[calls.polls++];
      return next
        ? HttpResponse.json(next)
        : HttpResponse.json({ message: 'no more statuses' }, { status: 404 });
    }),
  );
  return calls;
}

describe('Template', () => {
  describe('build()', () => {
    it('sends exactly the server contract', async () => {
      const calls = mockBuild([buildStatus('completed', [])]);

      await Template.build(makeTemplate(), 'my-template', {
        cpuCount: 4,
        memoryMb: 2048,
        diskMb: 1024,
        ...OPTS,
      });

      // The server ignores unknown fields, so "contains the fields" is not
      // enough — that is how apt_packages and background passed before.
      expect(calls.bodies).toEqual([
        {
          template: {
            base_image: 'ubuntu:22.04',
            packages: ['curl', 'git'],
            run_cmds: ['echo hello'],
          },
          alias: 'my-template',
          cpu_count: 4,
          memory_mb: 2048,
          disk_mb: 1024,
        },
      ]);
    });

    it('omits resources that were not set', async () => {
      const calls = mockBuild([buildStatus('completed', [])]);
      await Template.build(makeTemplate(), 'nodisk-tpl', OPTS);
      expect(calls.bodies[0]).not.toHaveProperty('disk_mb');
      expect(calls.bodies[0]).not.toHaveProperty('cpu_count');
      expect(calls.bodies[0]).not.toHaveProperty('memory_mb');
    });

    it('waits for completion and streams each log line once', async () => {
      const calls = mockBuild([
        buildStatus('building', ['Step 1/3']),
        buildStatus('building', ['Step 1/3', 'Step 2/3']),
        buildStatus('completed', ['Step 1/3', 'Step 2/3', 'Step 3/3']),
      ]);

      const logs: string[] = [];
      const result = await Template.build(makeTemplate(), 'log-test', {
        onBuildLogs: (log) => logs.push(log),
        ...OPTS,
      });

      expect(logs).toEqual(['Step 1/3', 'Step 2/3', 'Step 3/3']);
      expect(result).toEqual({
        buildId: 'bld-1',
        status: 'completed',
        templateId: 'tpl-1',
        logs: ['Step 1/3', 'Step 2/3', 'Step 3/3'],
      });
      expect(calls.polls).toBe(3);
    });

    it('throws BuildError carrying the logs when the build fails', async () => {
      const lines = Array.from({ length: 25 }, (_, i) => `line ${String(i + 1).padStart(2, '0')}`);
      mockBuild([buildStatus('failed', lines)]);

      const err = await Template.build(makeTemplate(), 'fail-tpl', OPTS).catch((e) => e);

      expect(err).toBeInstanceOf(BuildError);
      expect(err.buildId).toBe('bld-1');
      expect(err.logs).toEqual(lines);
      expect(err.message).toContain('line 25');
      expect(err.message).toContain('line 06');
      expect(err.message).not.toContain('line 05'); // only the last 20 lines are quoted
    });

    it('throws TimeoutError when the build is still running at the deadline', async () => {
      mockBuild([buildStatus('building', []), buildStatus('building', []), buildStatus('building', [])]);
      const err = await Template.build(makeTemplate(), 'slow-tpl', {
        buildTimeout: 0,
        ...OPTS,
      }).catch((e) => e);
      expect(err).toBeInstanceOf(TimeoutError);
      expect(err.message).toContain('bld-1');
    });

    it('rejects copy() before sending any request', async () => {
      const calls = mockBuild([buildStatus('completed', [])]);
      const template = makeTemplate().copy('./local.sh', '/usr/local/bin/local.sh');

      await expect(Template.build(template, 'copy-tpl', OPTS)).rejects.toBeInstanceOf(
        InvalidArgumentError,
      );
      await expect(Template.buildInBackground(template, 'copy-tpl', OPTS)).rejects.toBeInstanceOf(
        InvalidArgumentError,
      );
      expect(calls.bodies).toHaveLength(0);
    });
  });

  describe('buildInBackground()', () => {
    it('returns as soon as the build has started, without polling', async () => {
      const calls = mockBuild([buildStatus('completed', [])]);

      const result = await Template.buildInBackground(makeTemplate(), 'bg-tpl', {
        diskMb: 4096,
        ...OPTS,
      });

      expect(result).toEqual({ buildId: 'bld-1', status: 'building', templateId: 'tpl-1', logs: [] });
      expect(calls.polls).toBe(0);
      expect(calls.bodies).toEqual([
        {
          template: {
            base_image: 'ubuntu:22.04',
            packages: ['curl', 'git'],
            run_cmds: ['echo hello'],
          },
          alias: 'bg-tpl',
          disk_mb: 4096,
        },
      ]);
    });
  });

  describe('getBuildStatus()', () => {
    it('sends GET /templates/builds/:buildId and returns TemplateBuildStatus', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${BASE_URL}/templates/builds/bld-status-1`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({
            build_id: 'bld-status-1',
            status: 'completed',
            template_id: 'tpl-9',
            logs: ['Done'],
          });
        }),
      );

      const result = await Template.getBuildStatus('bld-status-1', OPTS);

      expect(capturedUrl).toContain('/templates/builds/bld-status-1');
      expect(result).toEqual({
        buildId: 'bld-status-1',
        status: 'completed',
        templateId: 'tpl-9',
        logs: ['Done'],
      });
    });

    it('closes client after fetching status', async () => {
      server.use(
        http.get(`${BASE_URL}/templates/builds/bld-close`, () =>
          HttpResponse.json({
            build_id: 'bld-close',
            status: 'building',
            logs: [],
          }),
        ),
      );

      const result = await Template.getBuildStatus('bld-close', OPTS);

      expect(result.buildId).toBe('bld-close');
    });
  });
});

// --- Streaming past the server's log cap, and failed status checks ---------

const NOTICE = '... [earlier build output truncated]';

/**
 * What sandbox-manager returns for a build that has produced `total` lines:
 * past its 2000-line cap, the truncation notice plus the newest 1999.
 */
function storedLogs(total: number): string[] {
  const lines = Array.from({ length: total }, (_, i) => `line ${i + 1}`);
  return total <= 2000 ? lines : [NOTICE, ...lines.slice(-1999)];
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}`);

describe('LogCursor', () => {
  it('hands out each line once across the cap', () => {
    const c = new LogCursor();
    expect(c.newLines(storedLogs(1980))).toEqual(range(1, 1980));
    expect(c.newLines(storedLogs(1980))).toEqual([]);
    expect(c.newLines(storedLogs(2050))).toEqual(range(1981, 2050));
    expect(c.newLines(storedLogs(2600))).toEqual(range(2051, 2600));
    // More output than the server keeps arrived between two polls: the notice
    // marks the gap before what remains.
    expect(c.newLines(storedLogs(9000))).toEqual(storedLogs(9000));
  });

  it('starts at the notice when following a build already past the cap', () => {
    expect(new LogCursor().newLines(storedLogs(2500))).toEqual(storedLogs(2500));
  });
});

describe('Template.build() waiting', () => {
  function mockPolls(respond: (poll: number) => Response) {
    const calls = { polls: 0 };
    server.use(
      http.post(`${BASE_URL}/templates/build`, () =>
        HttpResponse.json({ build_id: 'bld-1', status: 'building', template_id: 'tpl-1' }, { status: 201 }),
      ),
      http.get(`${BASE_URL}/templates/builds/bld-1`, () => respond(calls.polls++)),
    );
    return calls;
  }

  it('streams each line once across the log cap', async () => {
    const totals = [1980, 2050, 2600, 3000];
    mockPolls((i) =>
      HttpResponse.json(buildStatus(i >= totals.length - 1 ? 'completed' : 'building', storedLogs(totals[Math.min(i, totals.length - 1)]))),
    );
    const got: string[] = [];
    const result = await Template.build(makeTemplate(), 'big', { onBuildLogs: (l) => got.push(l), ...OPTS });
    expect(got).toEqual(range(1, 3000));
    expect(result.status).toBe('completed');
  });

  it('rides out temporary failures', async () => {
    const calls = mockPolls((i) => {
      if (i === 0) return HttpResponse.error(); // no response at all
      if (i < 4) return HttpResponse.json({ message: 'slow down' }, { status: 429 });
      return HttpResponse.json(buildStatus('completed', ['done']));
    });
    const result = await Template.build(makeTemplate(), 'flaky', OPTS);
    expect(result.status).toBe('completed');
    expect(calls.polls).toBeGreaterThanOrEqual(5);
  });

  it('gives up after the error window', async () => {
    const saved = buildPolling.errorWindowMs;
    buildPolling.errorWindowMs = 0;
    try {
      mockPolls(() => HttpResponse.json({ message: 'slow down' }, { status: 429 }));
      const err = await Template.build(makeTemplate(), 'flaky', OPTS).catch((e) => e);
      expect(err).toBeInstanceOf(SandboxError);
      expect(err.message).toContain('slow down');
    } finally {
      buildPolling.errorWindowMs = saved;
    }
  });

  it('stops at the deadline while status checks keep failing', async () => {
    mockPolls(() => HttpResponse.json({ message: 'slow down' }, { status: 429 }));
    const err = await Template.build(makeTemplate(), 'flaky', { buildTimeout: 50, ...OPTS }).catch((e) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err.message).toContain('slow down');
  });

  it('ends the wait on a rejection', async () => {
    // A short window, so a rejection wrongly treated as temporary shows up as
    // extra polls rather than a two-minute test.
    const saved = buildPolling.errorWindowMs;
    buildPolling.errorWindowMs = 200;
    try {
      const calls = mockPolls(() => HttpResponse.json({ message: 'build bld-1 not found' }, { status: 404 }));
      await expect(Template.build(makeTemplate(), 'gone', OPTS)).rejects.toBeInstanceOf(NotFoundError);
      expect(calls.polls).toBe(1);
    } finally {
      buildPolling.errorWindowMs = saved;
    }
  });
});

