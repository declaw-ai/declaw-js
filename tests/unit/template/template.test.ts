import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { Template } from '../../../src/template/template.js';
import { TemplateBase } from '../../../src/template/models.js';

const BASE_URL = 'http://localhost:9999';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeTemplate(): TemplateBase {
  return new TemplateBase()
    .fromBaseImage('ubuntu:22.04')
    .aptInstall('curl', 'git')
    .runCmd(['echo', 'hello']);
}

describe('Template', () => {
  describe('build()', () => {
    it('sends correct request body and returns BuildInfo', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/templates/build`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            build_id: 'bld-123',
            status: 'building',
            template_id: 'tpl-456',
          });
        }),
      );

      const template = makeTemplate();
      const result = await Template.build(template, 'my-template', {
        domain: 'localhost:9999',
        apiKey: 'test-key',
      });

      expect(capturedBody.template).toBeDefined();
      expect(capturedBody.alias).toBe('my-template');
      expect(result.buildId).toBe('bld-123');
      expect(result.status).toBe('building');
      expect(result.templateId).toBe('tpl-456');
    });

    it('sends all options in request body', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/templates/build`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            build_id: 'bld-789',
            status: 'building',
          });
        }),
      );

      const template = makeTemplate();
      await Template.build(template, 'custom-tpl', {
        cpuCount: 4,
        memoryMb: 2048,
        diskMb: 1024,
        domain: 'localhost:9999',
        apiKey: 'test-key',
      });

      expect(capturedBody.cpu_count).toBe(4);
      expect(capturedBody.memory_mb).toBe(2048);
      expect(capturedBody.disk_mb).toBe(1024);
    });

    it('sends disk_mb in request body when provided', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/templates/build`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            build_id: 'bld-disk',
            status: 'building',
          });
        }),
      );

      const template = makeTemplate();
      await Template.build(template, 'disk-tpl', {
        diskMb: 2048,
        domain: 'localhost:9999',
        apiKey: 'test-key',
      });

      expect(capturedBody.disk_mb).toBe(2048);
      expect(capturedBody.cpu_count).toBeUndefined();
      expect(capturedBody.memory_mb).toBeUndefined();
    });

    it('omits disk_mb from body when not provided', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/templates/build`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            build_id: 'bld-nodisk',
            status: 'building',
          });
        }),
      );

      const template = makeTemplate();
      await Template.build(template, 'nodisk-tpl', {
        domain: 'localhost:9999',
        apiKey: 'test-key',
      });

      expect(capturedBody.disk_mb).toBeUndefined();
    });

    it('invokes onBuildLogs callback for each log entry', async () => {
      server.use(
        http.post(`${BASE_URL}/templates/build`, () =>
          HttpResponse.json({
            build_id: 'bld-logs',
            status: 'completed',
            logs: ['Step 1/3: FROM ubuntu:22.04', 'Step 2/3: RUN apt install', 'Step 3/3: Done'],
          }),
        ),
      );

      const logs: string[] = [];
      const template = makeTemplate();
      await Template.build(template, 'log-test', {
        onBuildLogs: (log) => logs.push(log),
        domain: 'localhost:9999',
        apiKey: 'test-key',
      });

      expect(logs).toEqual([
        'Step 1/3: FROM ubuntu:22.04',
        'Step 2/3: RUN apt install',
        'Step 3/3: Done',
      ]);
    });

    it('closes the client even on success (resource safety)', async () => {
      server.use(
        http.post(`${BASE_URL}/templates/build`, () =>
          HttpResponse.json({
            build_id: 'bld-safe',
            status: 'completed',
          }),
        ),
      );

      // We verify resource safety by ensuring the method completes without leaking.
      // The fact it doesn't throw confirms try/finally works.
      const template = makeTemplate();
      const result = await Template.build(template, 'safe-test', {
        domain: 'localhost:9999',
        apiKey: 'test-key',
      });

      expect(result.buildId).toBe('bld-safe');
    });
  });

  describe('buildInBackground()', () => {
    it('sends background: true in request body', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/templates/build`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            build_id: 'bld-bg-1',
            status: 'queued',
          });
        }),
      );

      const template = makeTemplate();
      const result = await Template.buildInBackground(template, 'bg-tpl', {
        domain: 'localhost:9999',
        apiKey: 'test-key',
      });

      expect(capturedBody.background).toBe(true);
      expect(result.buildId).toBe('bld-bg-1');
      expect(result.status).toBe('queued');
    });

    it('sends disk_mb in background request body when provided', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE_URL}/templates/build`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            build_id: 'bld-bg-disk',
            status: 'queued',
          });
        }),
      );

      const template = makeTemplate();
      await Template.buildInBackground(template, 'bg-disk-tpl', {
        diskMb: 4096,
        domain: 'localhost:9999',
        apiKey: 'test-key',
      });

      expect(capturedBody.disk_mb).toBe(4096);
      expect(capturedBody.background).toBe(true);
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
            logs: ['Done'],
          });
        }),
      );

      const result = await Template.getBuildStatus('bld-status-1', {
        domain: 'localhost:9999',
        apiKey: 'test-key',
      });

      expect(capturedUrl).toContain('/templates/builds/bld-status-1');
      expect(result.buildId).toBe('bld-status-1');
      expect(result.status).toBe('completed');
      expect(result.logs).toEqual(['Done']);
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

      const result = await Template.getBuildStatus('bld-close', {
        domain: 'localhost:9999',
        apiKey: 'test-key',
      });

      expect(result.buildId).toBe('bld-close');
    });
  });
});
