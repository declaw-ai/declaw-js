import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { Governance } from '../../../src/governance/governance.js';
import { InvalidArgumentError } from '../../../src/errors.js';

const BASE_URL = 'http://localhost:9999';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Minimal valid pack fixture matching the wire schema. */
const PACK_FIXTURE = {
  name: 'owasp-llm-top10',
  version: 'v1',
  framework: 'OWASP Top 10 for LLM Applications (2025)',
  description: 'Enforces OWASP LLM Top 10 controls via sandbox gates.',
  gates: ['cmd', 'network', 'content'],
  enforces: [
    {
      control: 'OWASP-LLM06-ExcessiveAgency',
      gate: 'cmd',
      rule: 'Block shell commands that exhibit excessive agency.',
      playbook: 'Review agent permissions and restrict allowed commands.',
    },
  ],
  advisory: [
    {
      control: 'OWASP-LLM03-TrainingDataPoisoning',
      reason: 'Cannot be fully enforced at runtime; requires training-time controls.',
    },
  ],
  policy_ref: 'owasp-llm-top10@v1',
  seeded: true,
};

describe('Governance', () => {
  describe('listPacks()', () => {
    it('sends GET /governance/packs and returns parsed GovernancePack array', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${BASE_URL}/governance/packs`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ packs: [PACK_FIXTURE] });
        }),
      );

      const packs = await Governance.listPacks({
        domain: 'localhost:9999',
        apiKey: 'test-key',
      });

      expect(capturedUrl).toContain('/governance/packs');
      expect(packs).toHaveLength(1);

      const pack = packs[0];
      expect(pack.name).toBe('owasp-llm-top10');
      expect(pack.version).toBe('v1');
      expect(pack.framework).toBe('OWASP Top 10 for LLM Applications (2025)');
      expect(pack.description).toBe('Enforces OWASP LLM Top 10 controls via sandbox gates.');
      expect(pack.gates).toEqual(['cmd', 'network', 'content']);
      expect(pack.seeded).toBe(true);
      // wire field policy_ref → camelCase policyRef
      expect(pack.policyRef).toBe('owasp-llm-top10@v1');
    });

    it('maps enforces array correctly', async () => {
      server.use(
        http.get(`${BASE_URL}/governance/packs`, () =>
          HttpResponse.json({ packs: [PACK_FIXTURE] }),
        ),
      );

      const [pack] = await Governance.listPacks({ domain: 'localhost:9999', apiKey: 'test-key' });

      expect(pack.enforces).toHaveLength(1);
      expect(pack.enforces[0]).toEqual({
        control: 'OWASP-LLM06-ExcessiveAgency',
        gate: 'cmd',
        rule: 'Block shell commands that exhibit excessive agency.',
        playbook: 'Review agent permissions and restrict allowed commands.',
      });
    });

    it('maps advisory array correctly', async () => {
      server.use(
        http.get(`${BASE_URL}/governance/packs`, () =>
          HttpResponse.json({ packs: [PACK_FIXTURE] }),
        ),
      );

      const [pack] = await Governance.listPacks({ domain: 'localhost:9999', apiKey: 'test-key' });

      expect(pack.advisory).toHaveLength(1);
      expect(pack.advisory[0]).toEqual({
        control: 'OWASP-LLM03-TrainingDataPoisoning',
        reason: 'Cannot be fully enforced at runtime; requires training-time controls.',
      });
    });

    it('returns an empty array when packs is missing from response', async () => {
      server.use(
        http.get(`${BASE_URL}/governance/packs`, () => HttpResponse.json({})),
      );

      const packs = await Governance.listPacks({ domain: 'localhost:9999', apiKey: 'test-key' });
      expect(packs).toEqual([]);
    });

    it('returns an empty array when packs array is empty', async () => {
      server.use(
        http.get(`${BASE_URL}/governance/packs`, () => HttpResponse.json({ packs: [] })),
      );

      const packs = await Governance.listPacks({ domain: 'localhost:9999', apiKey: 'test-key' });
      expect(packs).toEqual([]);
    });

    it('sends Authorization header when API key is provided', async () => {
      let capturedAuth = '';
      server.use(
        http.get(`${BASE_URL}/governance/packs`, ({ request }) => {
          capturedAuth = request.headers.get('authorization') ?? '';
          return HttpResponse.json({ packs: [] });
        }),
      );

      await Governance.listPacks({ domain: 'localhost:9999', apiKey: 'my-key' });
      expect(capturedAuth).toBe('Bearer my-key');
    });
  });

  describe('getPack()', () => {
    it('sends GET /governance/packs/:name and returns a single GovernancePack', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${BASE_URL}/governance/packs/owasp-llm-top10`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(PACK_FIXTURE);
        }),
      );

      const pack = await Governance.getPack('owasp-llm-top10', {
        domain: 'localhost:9999',
        apiKey: 'test-key',
      });

      expect(capturedUrl).toContain('/governance/packs/owasp-llm-top10');
      expect(pack.name).toBe('owasp-llm-top10');
      expect(pack.policyRef).toBe('owasp-llm-top10@v1');
      expect(pack.seeded).toBe(true);
    });

    it('parses enforces and advisory from a single-pack response', async () => {
      server.use(
        http.get(`${BASE_URL}/governance/packs/owasp-llm-top10`, () =>
          HttpResponse.json(PACK_FIXTURE),
        ),
      );

      const pack = await Governance.getPack('owasp-llm-top10', {
        domain: 'localhost:9999',
        apiKey: 'test-key',
      });

      expect(pack.enforces).toHaveLength(1);
      expect(pack.enforces[0].control).toBe('OWASP-LLM06-ExcessiveAgency');
      expect(pack.advisory).toHaveLength(1);
      expect(pack.advisory[0].control).toBe('OWASP-LLM03-TrainingDataPoisoning');
    });

    it('throws InvalidArgumentError for pack names with path-injection characters', async () => {
      await expect(
        Governance.getPack('../etc/passwd', { domain: 'localhost:9999', apiKey: 'test-key' }),
      ).rejects.toThrow(InvalidArgumentError);
    });

    it('throws InvalidArgumentError for an empty pack name', async () => {
      await expect(
        Governance.getPack('', { domain: 'localhost:9999', apiKey: 'test-key' }),
      ).rejects.toThrow(InvalidArgumentError);
    });
  });
});
