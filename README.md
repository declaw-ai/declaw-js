# @declaw/sdk

Secure runtime for AI agents. Spin up isolated sandboxes in milliseconds with built-in guardrails — PII scanning, prompt injection defense, network isolation, and egress filtering.

## Install

```bash
npm install @declaw/sdk
```

## Quick Start

```typescript
import { Sandbox } from '@declaw/sdk';

const sandbox = await Sandbox.create({
  apiKey: 'your-api-key',
  template: 'base',
  timeout: 60,
});

// Run commands
const result = await sandbox.commands.run('echo "Hello from a secure sandbox"');
console.log(result.stdout);

// Read/write files
await sandbox.files.write('/tmp/hello.txt', 'Hello World');
const content = await sandbox.files.read('/tmp/hello.txt');

// Clean up
await sandbox.kill();
```

## Why Declaw?

AI agents need to execute code, call APIs, and interact with the world. Declaw gives them a secure sandbox to do it — with built-in guardrails that protect your users and infrastructure.

- **Sub-10ms sandbox creation** — pre-warmed VM pool, no cold starts
- **Network isolation** — per-sandbox firewall with domain and CIDR rules
- **Full file system** — read, write, upload, download files in the sandbox

## Security & Guardrails

Every outbound request from the sandbox passes through a configurable security pipeline.

### PII Scanning

Detect and redact sensitive data before it leaves the sandbox.

```typescript
const sandbox = await Sandbox.create({
  security: SecurityPolicy.from({
    pii: {
      enabled: true,
      types: ['ssn', 'credit_card', 'email', 'phone', 'api_key'],
      action: 'redact',
    },
  }),
});
```

### Prompt Injection Defense

Block prompt injection attempts in agent outputs.

```typescript
const sandbox = await Sandbox.create({
  security: SecurityPolicy.from({
    injectionDefense: {
      enabled: true,
      action: 'block',
      threshold: 0.85,
    },
  }),
});
```

### Toxicity Filtering

```typescript
security: SecurityPolicy.from({
  toxicity: { enabled: true, action: 'block', threshold: 0.7 },
})
```

### Code Security & Invisible Text Detection

```typescript
security: SecurityPolicy.from({
  codeSecurity: { enabled: true, action: 'log' },
  invisibleText: { enabled: true, action: 'block' },
})
```

### Network Policies

```typescript
// Allow only specific domains
const sandbox = await Sandbox.create({
  network: { allowOut: ['api.openai.com', 'huggingface.co'] },
});

// Block all egress
const isolated = await Sandbox.create({
  network: { denyOut: ['ALL_TRAFFIC'] },
});
```

### Data Transformation

Transform sensitive values in-flight.

```typescript
security: SecurityPolicy.from({
  transformations: [
    { pattern: 'sk-[a-zA-Z0-9]+', replacement: '[API_KEY]', direction: 'egress' },
  ],
})
```

### Combining Guardrails

All guardrails compose — enable multiple and they run in sequence:

```typescript
const sandbox = await Sandbox.create({
  template: 'ai-agent',
  timeout: 300,
  network: { allowOut: ['api.openai.com', 'api.anthropic.com'] },
  security: SecurityPolicy.from({
    pii: { enabled: true, action: 'redact', types: ['ssn', 'credit_card'] },
    injectionDefense: { enabled: true, action: 'block' },
    toxicity: { enabled: true, action: 'log' },
    invisibleText: { enabled: true, action: 'block' },
  }),
});
```

## Templates

| Template | Description |
|----------|-------------|
| `base` | Minimal Linux |
| `python` | Python 3.12 with pip |
| `node` | Node.js 22 LTS with npm |
| `code-interpreter` | Python with data science libraries |
| `ai-agent` | Python + Node.js + AI/ML tools |
| `mcp-server` | MCP server runtime |
| `web-dev` | Node.js + browser testing |
| `devops` | Docker, Terraform, kubectl |

## API

```typescript
// Create sandbox
const sandbox = await Sandbox.create({ template, apiKey, timeout, network, security });

// Commands
const result = await sandbox.commands.run('ls -la');
const stream = sandbox.commands.stream('python script.py');

// Files — `path` is the literal absolute path inside the sandbox.
// Files appear at exactly that path — no remapping, no bridge directory.
await sandbox.files.write(path, content);
const data = await sandbox.files.read(path);
const entries = await sandbox.files.list('/');

// PTY (interactive terminal)
const pty = await sandbox.pty.create({ cols: 80, rows: 24 });

// Lifecycle
await sandbox.kill();
```

## License

Apache-2.0
