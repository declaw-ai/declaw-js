import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { Vault, expandVaultRefs } from '../../../src/vault/vault.js';
import { vaultScopeToJSON } from '../../../src/vault/models.js';
import { ConnectionConfig } from '../../../src/connectionConfig.js';

const BASE_URL = 'http://localhost:9999';
const OPTS = { domain: 'localhost:9999', apiKey: 'test-key' };

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Reset the module-level default team cache between tests so each test starts
// fresh and doesn't bleed state to the next.
beforeEach(async () => {
  // Re-import to access the cache directly is not clean in ESM — instead we
  // rely on unique apiKey values per test where isolation matters, or we
  // ensure our mock handlers cover the GET /teams call every time.
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT_TEAM_FIXTURE = {
  team_id: 'team-def',
  owner_id: 'acct-1',
  name: 'default',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const DEFAULT_ENV_FIXTURE = {
  env_id: 'env-prod',
  team_id: 'team-def',
  name: 'prod',
  created_at: '2026-01-01T00:00:00Z',
};

const SECRET_FIXTURE = {
  secret_id: 'sec-111',
  team_id: 'team-def',
  env_id: 'env-prod',
  name: 'openai',
  scopes: [
    {
      domain_regex: '.*\\.openai\\.com',
      injection_type: 'bearer',
    },
  ],
  created_at: '2026-01-05T00:00:00Z',
  updated_at: '2026-01-05T00:00:00Z',
  rotation_interval_days: 30,
  rotation_due: false,
};

const PRESET_FIXTURE = {
  key: 'openai',
  name: 'OpenAI',
  category: 'ai-provider',
  key_hint: 'sk-...',
  docs_url: 'https://platform.openai.com/docs/api-reference',
  scopes: [
    {
      domain_regex: '.*\\.openai\\.com',
      injection_type: 'bearer',
    },
  ],
};

// ---------------------------------------------------------------------------
// Helper: wire up the standard "default team + prod env already exist" handlers
// before delegating to the test-specific handler. Mirrors go-sdk's
// defaultTeamHandler.
// ---------------------------------------------------------------------------
function withDefaultTeam(testHandler: Parameters<typeof server.use>[0]): Parameters<typeof server.use> {
  return [
    http.get(`${BASE_URL}/teams`, () =>
      HttpResponse.json({ teams: [DEFAULT_TEAM_FIXTURE] }),
    ),
    http.get(`${BASE_URL}/teams/team-def/environments`, () =>
      HttpResponse.json({ environments: [DEFAULT_ENV_FIXTURE] }),
    ),
    testHandler,
  ];
}

// ---------------------------------------------------------------------------
// resolveDefaultTeamId — get-or-create
// ---------------------------------------------------------------------------

describe('resolveDefaultTeamId — existing default team', () => {
  it('GETs /teams, picks the oldest "default" team, and caches the id', async () => {
    let getCount = 0;
    server.use(
      http.get(`${BASE_URL}/teams`, () => {
        getCount++;
        return HttpResponse.json({
          teams: [
            { team_id: 'team-new', name: 'default', created_at: '2026-06-01T00:00:00Z' },
            { team_id: 'team-old', name: 'default', created_at: '2026-01-01T00:00:00Z' },
          ],
        });
      }),
    );

    // Use a unique apiKey so the cache from other tests doesn't interfere.
    const config = new ConnectionConfig({ domain: 'localhost:9999', apiKey: 'key-oldest' });
    const { resolveDefaultTeamId } = await import('../../../src/vault/vault.js');
    const id = await resolveDefaultTeamId(config, false);
    expect(id).toBe('team-old'); // oldest chosen
    expect(getCount).toBe(1);
  });

  it('returns null when no default team exists and create=false', async () => {
    server.use(
      http.get(`${BASE_URL}/teams`, () => HttpResponse.json({ teams: [] })),
    );
    const config = new ConnectionConfig({ domain: 'localhost:9999', apiKey: 'key-nocreate' });
    const { resolveDefaultTeamId } = await import('../../../src/vault/vault.js');
    const id = await resolveDefaultTeamId(config, false);
    expect(id).toBeNull();
  });
});

describe('resolveDefaultTeamId — auto-provision', () => {
  it('POSTs /teams {name:"default"} when none exist and create=true', async () => {
    let posted = false;
    let capturedBody: unknown;
    server.use(
      http.get(`${BASE_URL}/teams`, () => HttpResponse.json({ teams: [] })),
      http.post(`${BASE_URL}/teams`, async ({ request }) => {
        posted = true;
        capturedBody = await request.json();
        return HttpResponse.json(
          { team_id: 'team-auto', name: 'default', created_at: '2026-06-01T00:00:00Z' },
          { status: 201 },
        );
      }),
    );
    const config = new ConnectionConfig({ domain: 'localhost:9999', apiKey: 'key-autoprov' });
    const { resolveDefaultTeamId } = await import('../../../src/vault/vault.js');
    const id = await resolveDefaultTeamId(config, true);
    expect(id).toBe('team-auto');
    expect(posted).toBe(true);
    expect(capturedBody).toEqual({ name: 'default' });
  });
});

// ---------------------------------------------------------------------------
// Vault.createSecret — defaults team + prod, auto-provisions when absent
// ---------------------------------------------------------------------------

describe('Vault.createSecret — uses default team and prod environment', () => {
  it('resolves default team, ensures prod env, then POSTs with environment=prod', async () => {
    let capturedPath = '';
    let capturedBody: unknown;
    server.use(
      ...withDefaultTeam(
        http.post(`${BASE_URL}/teams/team-def/vault/secrets`, async ({ request }) => {
          capturedPath = new URL(request.url).pathname;
          capturedBody = await request.json();
          return HttpResponse.json(SECRET_FIXTURE, { status: 201 });
        }),
      ),
    );

    const secret = await Vault.createSecret(
      { value: 'sk-test-abc', provider: 'openai', name: 'openai' },
      { ...OPTS, apiKey: 'key-create-default' },
    );

    expect(capturedPath).toBe('/teams/team-def/vault/secrets');
    expect((capturedBody as Record<string, unknown>).environment).toBe('prod');
    expect((capturedBody as Record<string, unknown>).value).toBe('sk-test-abc');
    expect((capturedBody as Record<string, unknown>).provider).toBe('openai');
    expect(secret.secretId).toBe('sec-111');
    expect(secret.name).toBe('openai');
  });

  it('sends Authorization header with the API key', async () => {
    let capturedAuth = '';
    server.use(
      ...withDefaultTeam(
        http.post(`${BASE_URL}/teams/team-def/vault/secrets`, ({ request }) => {
          capturedAuth = request.headers.get('authorization') ?? '';
          return HttpResponse.json(SECRET_FIXTURE, { status: 201 });
        }),
      ),
    );
    await Vault.createSecret(
      { value: 'sk-x', provider: 'openai' },
      { domain: 'localhost:9999', apiKey: 'my-secret-key-create' },
    );
    expect(capturedAuth).toBe('Bearer my-secret-key-create');
  });
});

describe('Vault.createSecret — auto-provisions default team + prod env', () => {
  it('creates team when absent, creates env when absent, then posts secret', async () => {
    let createdTeam = false;
    let createdEnv = false;
    server.use(
      http.get(`${BASE_URL}/teams`, () => HttpResponse.json({ teams: [] })),
      http.post(`${BASE_URL}/teams`, () => {
        createdTeam = true;
        return HttpResponse.json(
          { team_id: 'team-new', name: 'default', created_at: '2026-06-01T00:00:00Z' },
          { status: 201 },
        );
      }),
      http.get(`${BASE_URL}/teams/team-new/environments`, () =>
        HttpResponse.json({ environments: [] }),
      ),
      http.post(`${BASE_URL}/teams/team-new/environments`, () => {
        createdEnv = true;
        return HttpResponse.json(
          { env_id: 'env-prod', name: 'prod' },
          { status: 201 },
        );
      }),
      http.post(`${BASE_URL}/teams/team-new/vault/secrets`, () =>
        HttpResponse.json({ secret_id: 'sec-9', name: 'stripe', created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z' }, { status: 201 }),
      ),
    );

    const secret = await Vault.createSecret(
      {
        name: 'stripe',
        value: 'sk',
        scopes: [{ domainRegex: '^api\\.stripe\\.com$', injectionType: 'bearer' }],
      },
      { domain: 'localhost:9999', apiKey: 'key-autoprov-create' },
    );

    expect(createdTeam).toBe(true);
    expect(createdEnv).toBe(true);
    expect(secret.secretId).toBe('sec-9');
  });
});

describe('Vault.createSecret — scopes variant', () => {
  it('serializes scopes as snake_case and includes rotation_interval_days', async () => {
    let capturedBody: Record<string, unknown> = {};
    server.use(
      ...withDefaultTeam(
        http.post(`${BASE_URL}/teams/team-def/vault/secrets`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(SECRET_FIXTURE, { status: 201 });
        }),
      ),
    );

    await Vault.createSecret(
      {
        value: 'my-api-key',
        name: 'my-service',
        scopes: [
          {
            domainRegex: '.*\\.example\\.com',
            injectionType: 'bearer',
            headerName: 'Authorization',
            valuePrefix: 'Bearer',
            extraHeaders: { 'X-Version': '2' },
            queryParams: { format: 'json' },
          },
        ],
        rotationIntervalDays: 90,
      },
      { domain: 'localhost:9999', apiKey: 'key-scopes-variant' },
    );

    expect(capturedBody.environment).toBe('prod');
    expect(capturedBody.name).toBe('my-service');
    expect(capturedBody.rotation_interval_days).toBe(90);
    const scopes = capturedBody.scopes as Record<string, unknown>[];
    expect(Array.isArray(scopes)).toBe(true);
    expect(scopes).toHaveLength(1);
    expect(scopes[0].domain_regex).toBe('.*\\.example\\.com');
    expect(scopes[0].injection_type).toBe('bearer');
    expect(scopes[0].header_name).toBe('Authorization');
    expect(scopes[0].value_prefix).toBe('Bearer');
    expect(scopes[0].extra_headers).toEqual({ 'X-Version': '2' });
    expect(scopes[0].query_params).toEqual({ format: 'json' });
  });

  it('omits rotation_interval_days when not set', async () => {
    let capturedBody: Record<string, unknown> = {};
    server.use(
      ...withDefaultTeam(
        http.post(`${BASE_URL}/teams/team-def/vault/secrets`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(SECRET_FIXTURE, { status: 201 });
        }),
      ),
    );

    await Vault.createSecret(
      { value: 'sk-test', provider: 'openai' },
      { domain: 'localhost:9999', apiKey: 'key-no-rotation' },
    );
    expect(capturedBody).not.toHaveProperty('rotation_interval_days');
  });

  it('omits scopes from body when not provided', async () => {
    let capturedBody: Record<string, unknown> = {};
    server.use(
      ...withDefaultTeam(
        http.post(`${BASE_URL}/teams/team-def/vault/secrets`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(SECRET_FIXTURE, { status: 201 });
        }),
      ),
    );

    await Vault.createSecret(
      { value: 'sk-test', provider: 'openai' },
      { domain: 'localhost:9999', apiKey: 'key-no-scopes' },
    );
    expect(capturedBody).not.toHaveProperty('scopes');
  });
});

// ---------------------------------------------------------------------------
// Vault.listSecrets
// ---------------------------------------------------------------------------

describe('Vault.listSecrets', () => {
  it('GETs /teams/{teamId}/vault/secrets and returns parsed VaultSecret array', async () => {
    server.use(
      http.get(`${BASE_URL}/teams`, () =>
        HttpResponse.json({ teams: [DEFAULT_TEAM_FIXTURE] }),
      ),
      http.get(`${BASE_URL}/teams/team-def/vault/secrets`, () =>
        HttpResponse.json({ secrets: [SECRET_FIXTURE] }),
      ),
    );

    const secrets = await Vault.listSecrets({ domain: 'localhost:9999', apiKey: 'key-list' });
    expect(secrets).toHaveLength(1);
    expect(secrets[0].secretId).toBe('sec-111');
    expect(secrets[0].name).toBe('openai');
    expect(secrets[0].rotationIntervalDays).toBe(30);
    expect(secrets[0].rotationDue).toBe(false);
  });

  it('returns an empty array when no default team has been provisioned', async () => {
    server.use(
      http.get(`${BASE_URL}/teams`, () => HttpResponse.json({ teams: [] })),
    );

    const secrets = await Vault.listSecrets({ domain: 'localhost:9999', apiKey: 'key-list-empty' });
    expect(secrets).toEqual([]);
  });

  it('parses scopes from returned secrets', async () => {
    server.use(
      http.get(`${BASE_URL}/teams`, () =>
        HttpResponse.json({ teams: [DEFAULT_TEAM_FIXTURE] }),
      ),
      http.get(`${BASE_URL}/teams/team-def/vault/secrets`, () =>
        HttpResponse.json({ secrets: [SECRET_FIXTURE] }),
      ),
    );

    const secrets = await Vault.listSecrets({ domain: 'localhost:9999', apiKey: 'key-list-scopes' });
    expect(secrets[0].scopes).toBeDefined();
    expect(secrets[0].scopes).toHaveLength(1);
    expect(secrets[0].scopes![0].domainRegex).toBe('.*\\.openai\\.com');
    expect(secrets[0].scopes![0].injectionType).toBe('bearer');
  });
});

// ---------------------------------------------------------------------------
// Vault.rotateSecret — by name
// ---------------------------------------------------------------------------

describe('Vault.rotateSecret — by name', () => {
  it('resolves name to secretId via listSecrets, then POSTs to /rotate', async () => {
    let rotatedId = '';
    let capturedBody: unknown;
    server.use(
      ...withDefaultTeam(
        http.get(`${BASE_URL}/teams/team-def/vault/secrets`, () =>
          HttpResponse.json({ secrets: [{ ...SECRET_FIXTURE, secret_id: 'sec-42', name: 'stripe' }] }),
        ),
      ),
      http.post(
        `${BASE_URL}/teams/team-def/vault/secrets/sec-42/rotate`,
        async ({ request }) => {
          rotatedId = 'sec-42';
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );

    await expect(
      Vault.rotateSecret('stripe', 'new-val', { domain: 'localhost:9999', apiKey: 'key-rotate' }),
    ).resolves.toBeUndefined();
    expect(rotatedId).toBe('sec-42');
    expect(capturedBody).toEqual({ value: 'new-val' });
  });

  it('throws when secret name does not exist', async () => {
    server.use(
      ...withDefaultTeam(
        http.get(`${BASE_URL}/teams/team-def/vault/secrets`, () =>
          HttpResponse.json({ secrets: [] }),
        ),
      ),
    );

    await expect(
      Vault.rotateSecret('ghost', 'val', { domain: 'localhost:9999', apiKey: 'key-rotate-notfound' }),
    ).rejects.toThrow('"ghost" not found');
  });
});

// ---------------------------------------------------------------------------
// Vault.deleteSecret — by name
// ---------------------------------------------------------------------------

describe('Vault.deleteSecret — by name', () => {
  it('resolves name to secretId via listSecrets, then DELETEs', async () => {
    let deletedPath = '';
    server.use(
      ...withDefaultTeam(
        http.get(`${BASE_URL}/teams/team-def/vault/secrets`, () =>
          HttpResponse.json({ secrets: [{ ...SECRET_FIXTURE, secret_id: 'sec-7', name: 'openai' }] }),
        ),
      ),
      http.delete(`${BASE_URL}/teams/team-def/vault/secrets/sec-7`, ({ request }) => {
        deletedPath = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await expect(
      Vault.deleteSecret('openai', { domain: 'localhost:9999', apiKey: 'key-delete' }),
    ).resolves.toBeUndefined();
    expect(deletedPath).toBe('/teams/team-def/vault/secrets/sec-7');
  });

  it('throws when secret name does not exist', async () => {
    server.use(
      ...withDefaultTeam(
        http.get(`${BASE_URL}/teams/team-def/vault/secrets`, () =>
          HttpResponse.json({ secrets: [] }),
        ),
      ),
    );

    await expect(
      Vault.deleteSecret('ghost', { domain: 'localhost:9999', apiKey: 'key-delete-notfound' }),
    ).rejects.toThrow('"ghost" not found');
  });

  it('throws when no default team exists', async () => {
    server.use(
      http.get(`${BASE_URL}/teams`, () => HttpResponse.json({ teams: [] })),
    );

    await expect(
      Vault.deleteSecret('ghost', { domain: 'localhost:9999', apiKey: 'key-delete-noteam' }),
    ).rejects.toThrow('"ghost" not found');
  });
});

// ---------------------------------------------------------------------------
// Vault.listPresets
// ---------------------------------------------------------------------------

describe('Vault.listPresets', () => {
  it('GETs /vault/presets and returns parsed VaultPreset array', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE_URL}/vault/presets`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ presets: [PRESET_FIXTURE] });
      }),
    );

    const presets = await Vault.listPresets(OPTS);

    expect(capturedUrl).toContain('/vault/presets');
    expect(presets).toHaveLength(1);
    const preset = presets[0];
    expect(preset.key).toBe('openai');
    expect(preset.name).toBe('OpenAI');
    expect(preset.category).toBe('ai-provider');
    expect(preset.keyHint).toBe('sk-...');
    expect(preset.docsUrl).toBe('https://platform.openai.com/docs/api-reference');
    expect(preset.scopes).toHaveLength(1);
    expect(preset.scopes[0].domainRegex).toBe('.*\\.openai\\.com');
    expect(preset.scopes[0].injectionType).toBe('bearer');
  });

  it('returns an empty array when presets is missing from response', async () => {
    server.use(
      http.get(`${BASE_URL}/vault/presets`, () => HttpResponse.json({})),
    );

    const presets = await Vault.listPresets(OPTS);
    expect(presets).toEqual([]);
  });

  it('sends Authorization header when API key is provided', async () => {
    let capturedAuth = '';
    server.use(
      http.get(`${BASE_URL}/vault/presets`, ({ request }) => {
        capturedAuth = request.headers.get('authorization') ?? '';
        return HttpResponse.json({ presets: [] });
      }),
    );

    await Vault.listPresets({ domain: 'localhost:9999', apiKey: 'my-secret-key' });
    expect(capturedAuth).toBe('Bearer my-secret-key');
  });
});

// ---------------------------------------------------------------------------
// expandVaultRefs — bare-name expansion
// ---------------------------------------------------------------------------

describe('expandVaultRefs', () => {
  it('passes through values that already start with vault://', async () => {
    server.use(
      http.get(`${BASE_URL}/teams`, () =>
        HttpResponse.json({ teams: [DEFAULT_TEAM_FIXTURE] }),
      ),
    );
    const config = new ConnectionConfig({ domain: 'localhost:9999', apiKey: 'key-expand-passthrough' });
    const result = await expandVaultRefs(config, {
      MY_KEY: 'vault://team-xyz/prod/my-secret',
    });
    expect(result).toEqual({ MY_KEY: 'vault://team-xyz/prod/my-secret' });
  });

  it('expands bare names to vault://<teamId>/prod/<name>', async () => {
    server.use(
      http.get(`${BASE_URL}/teams`, () =>
        HttpResponse.json({ teams: [DEFAULT_TEAM_FIXTURE] }),
      ),
    );
    const config = new ConnectionConfig({ domain: 'localhost:9999', apiKey: 'key-expand-bare' });
    const result = await expandVaultRefs(config, { OPENAI_KEY: 'openai' });
    expect(result).toEqual({ OPENAI_KEY: 'vault://team-def/prod/openai' });
  });

  it('returns empty object unchanged without hitting /teams', async () => {
    // No handlers — any request would throw with onUnhandledRequest: 'error'
    const config = new ConnectionConfig({ domain: 'localhost:9999', apiKey: 'key-expand-empty' });
    const result = await expandVaultRefs(config, {});
    expect(result).toEqual({});
  });

  it('throws when bare names are present but no default team exists', async () => {
    server.use(
      http.get(`${BASE_URL}/teams`, () => HttpResponse.json({ teams: [] })),
    );
    const config = new ConnectionConfig({ domain: 'localhost:9999', apiKey: 'key-expand-noteam' });
    await expect(expandVaultRefs(config, { KEY: 'openai' })).rejects.toThrow(
      'vault_refs given but no vault secrets exist for this account',
    );
  });

  it('mixes bare names and vault:// values in the same map', async () => {
    server.use(
      http.get(`${BASE_URL}/teams`, () =>
        HttpResponse.json({ teams: [DEFAULT_TEAM_FIXTURE] }),
      ),
    );
    const config = new ConnectionConfig({ domain: 'localhost:9999', apiKey: 'key-expand-mixed' });
    const result = await expandVaultRefs(config, {
      EXPLICIT: 'vault://other-team/dev/my-k',
      BARE: 'stripe',
    });
    expect(result.EXPLICIT).toBe('vault://other-team/dev/my-k');
    expect(result.BARE).toBe('vault://team-def/prod/stripe');
  });
});

// ---------------------------------------------------------------------------
// vaultScopeToJSON unit tests
// ---------------------------------------------------------------------------

describe('vaultScopeToJSON', () => {
  it('emits only domain_regex for a minimal scope', () => {
    expect(vaultScopeToJSON({ domainRegex: '.*\\.openai\\.com' })).toEqual({
      domain_regex: '.*\\.openai\\.com',
    });
  });

  it('emits all optional fields as snake_case when set', () => {
    expect(
      vaultScopeToJSON({
        domainRegex: '.*\\.example\\.com',
        injectionType: 'bearer',
        headerName: 'Authorization',
        valuePrefix: 'Bearer',
        basicUsername: 'user',
        extraHeaders: { 'X-Foo': 'bar' },
        queryParams: { api: 'v2' },
      }),
    ).toEqual({
      domain_regex: '.*\\.example\\.com',
      injection_type: 'bearer',
      header_name: 'Authorization',
      value_prefix: 'Bearer',
      basic_username: 'user',
      extra_headers: { 'X-Foo': 'bar' },
      query_params: { api: 'v2' },
    });
  });
});
