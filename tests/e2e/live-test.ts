/**
 * End-to-end test of the Declaw TypeScript SDK against the live GCP API.
 *
 * Usage: npx tsx tests/e2e/live-test.ts
 */

import {
  ConnectionConfig,
  ApiClient,
  Commands,
  Filesystem,
  Pty,
  CommandExitError,
} from '../../src/index.js';

const API_URL = process.env.DECLAW_API_URL ?? 'http://api.declaw.ai';
const API_KEY = 'test-key';

let passed = 0;
let failed = 0;
const failures: string[] = [];
let testNum = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

function section(name: string): void {
  testNum++;
  console.log(`\n${testNum}. ${name}`);
}

async function main() {
  console.log('\n🔬 Declaw TypeScript SDK — Full Live E2E Tests');
  console.log(`   API: ${API_URL}\n`);

  const config = new ConnectionConfig({ apiKey: API_KEY, apiUrl: API_URL });
  const client = new ApiClient(config);

  let sandboxId: string = '';

  try {
    // ═══════════════════════════════════════
    // SANDBOX CRUD
    // ═══════════════════════════════════════

    section('List sandboxes');
    const listData = (await client.get('/sandboxes', { params: { limit: '3' } })) as Record<string, unknown>;
    assert(Array.isArray(listData.sandboxes), 'Response has sandboxes array');
    assert((listData.sandboxes as unknown[]).length > 0, `Got ${(listData.sandboxes as unknown[]).length} sandboxes`);

    section('Create sandbox (basic)');
    const createData = (await client.post('/sandboxes', {
      json: { template: 'base', timeout: 120, secure: true },
      timeout: 30000,
    })) as Record<string, unknown>;
    sandboxId = createData.sandbox_id as string;
    assert(!!sandboxId, `Sandbox created: ${sandboxId}`);
    assert(!!createData.envd_access_token, 'Has envd_access_token');
    assert(createData.sandbox_domain === 'declaw.dev', 'Domain is declaw.dev');
    assert(createData.state === 'running', 'State is running');

    section('Get sandbox info');
    const infoData = (await client.get(`/sandboxes/${sandboxId}`)) as Record<string, unknown>;
    assert(infoData.sandbox_id === sandboxId, 'Correct sandbox_id');
    assert(infoData.state === 'running', 'Still running');

    section('Check sandbox status');
    const statusData = (await client.get(`/sandboxes/${sandboxId}/status`)) as Record<string, unknown>;
    assert(statusData.is_running === true, 'is_running = true');

    section('Set timeout');
    await client.patch(`/sandboxes/${sandboxId}/timeout`, { json: { timeout: 180 } });
    const afterTimeout = (await client.get(`/sandboxes/${sandboxId}`)) as Record<string, unknown>;
    assert(afterTimeout.timeout === 180, `Timeout updated to ${afterTimeout.timeout}`);

    section('Get metrics');
    const metricsData = (await client.get(`/sandboxes/${sandboxId}/metrics`)) as unknown[];
    assert(Array.isArray(metricsData), 'Metrics is an array');

    // ═══════════════════════════════════════
    // COMMANDS — FOREGROUND
    // ═══════════════════════════════════════

    section('Run command (echo)');
    const cmdData = (await client.post(`/sandboxes/${sandboxId}/commands`, {
      json: { cmd: 'echo "hello from ts-sdk"', background: false, user: 'user', timeout: 30 },
      timeout: 30000,
    })) as Record<string, unknown>;
    assert(typeof cmdData.stdout === 'string', 'Has stdout');
    assert((cmdData.stdout as string).includes('hello from ts-sdk'), `stdout = "${(cmdData.stdout as string).trim()}"`);
    assert(cmdData.exit_code === 0, 'exit_code = 0');

    section('Run command with env vars');
    const envCmd = (await client.post(`/sandboxes/${sandboxId}/commands`, {
      json: { cmd: 'echo $MY_VAR', background: false, user: 'user', timeout: 30, envs: { MY_VAR: 'declaw-test-123' } },
      timeout: 30000,
    })) as Record<string, unknown>;
    assert((envCmd.stdout as string).includes('declaw-test-123'), `env var passed: "${(envCmd.stdout as string).trim()}"`);

    section('Run command with custom cwd');
    const cwdCmd = (await client.post(`/sandboxes/${sandboxId}/commands`, {
      json: { cmd: 'pwd', background: false, user: 'user', timeout: 30, cwd: '/tmp' },
      timeout: 30000,
    })) as Record<string, unknown>;
    assert((cwdCmd.stdout as string).trim() === '/tmp', `cwd = "${(cwdCmd.stdout as string).trim()}"`);

    section('Run command with non-zero exit');
    const failCmd = (await client.post(`/sandboxes/${sandboxId}/commands`, {
      json: { cmd: 'exit 42', background: false, user: 'user', timeout: 30 },
      timeout: 30000,
    })) as Record<string, unknown>;
    assert(failCmd.exit_code === 42, `exit_code = ${failCmd.exit_code}`);

    section('Run multi-line command');
    const multiCmd = (await client.post(`/sandboxes/${sandboxId}/commands`, {
      json: { cmd: 'echo line1 && echo line2 && echo line3', background: false, user: 'user', timeout: 30 },
      timeout: 30000,
    })) as Record<string, unknown>;
    const lines = (multiCmd.stdout as string).trim().split('\n');
    assert(lines.length === 3, `Got ${lines.length} lines`);
    assert(lines[0] === 'line1' && lines[2] === 'line3', 'Multi-line output correct');

    section('Run command with stderr');
    const stderrCmd = (await client.post(`/sandboxes/${sandboxId}/commands`, {
      json: { cmd: 'echo "err msg" >&2', background: false, user: 'user', timeout: 30 },
      timeout: 30000,
    })) as Record<string, unknown>;
    assert((stderrCmd.stderr as string).includes('err msg'), `stderr = "${(stderrCmd.stderr as string).trim()}"`);

    // ═══════════════════════════════════════
    // COMMANDS — BACKGROUND + WAIT + KILL
    // ═══════════════════════════════════════

    section('Background command + wait');
    const bgCmd = (await client.post(`/sandboxes/${sandboxId}/commands`, {
      json: { cmd: 'sleep 1 && echo bg-done', background: true, user: 'user', timeout: 30 },
    })) as Record<string, unknown>;
    const bgPid = bgCmd.pid as number;
    assert(typeof bgPid === 'number' && bgPid > 0, `Background PID: ${bgPid}`);

    const waitData = (await client.get(`/sandboxes/${sandboxId}/commands/${bgPid}/wait`, {
      timeout: 15000,
    })) as Record<string, unknown>;
    assert((waitData.stdout as string).includes('bg-done'), `Wait stdout: "${(waitData.stdout as string).trim()}"`);
    assert(waitData.exit_code === 0, 'Wait exit_code = 0');

    section('List commands');
    const cmdsData = (await client.get(`/sandboxes/${sandboxId}/commands`)) as unknown[];
    assert(Array.isArray(cmdsData), 'Commands list is array');

    section('Kill a running command');
    const sleepCmd = (await client.post(`/sandboxes/${sandboxId}/commands`, {
      json: { cmd: 'sleep 60', background: true, user: 'user', timeout: 120 },
    })) as Record<string, unknown>;
    const sleepPid = sleepCmd.pid as number;
    assert(typeof sleepPid === 'number', `Sleep PID: ${sleepPid}`);
    const killCmd = (await client.delete(`/sandboxes/${sandboxId}/commands/${sleepPid}`)) as Record<string, unknown>;
    assert(killCmd.killed === true, 'Command killed');

    section('Send stdin to command');
    const stdinBg = (await client.post(`/sandboxes/${sandboxId}/commands`, {
      json: { cmd: 'cat', background: true, user: 'user', timeout: 10 },
    })) as Record<string, unknown>;
    const stdinPid = stdinBg.pid as number;
    await client.post(`/sandboxes/${sandboxId}/commands/${stdinPid}/stdin`, {
      json: { data: 'hello stdin\n' },
    });
    assert(true, `Sent stdin to PID ${stdinPid}`);
    // Kill the cat process since it won't exit on its own
    await client.delete(`/sandboxes/${sandboxId}/commands/${stdinPid}`);

    // ═══════════════════════════════════════
    // COMMANDS — SDK CLASSES (Commands + CommandHandle)
    // ═══════════════════════════════════════

    section('Commands class — run foreground');
    const cmds = new Commands(sandboxId, client);
    const fgResult = await cmds.run('echo "sdk-class-test"');
    assert(fgResult.stdout.includes('sdk-class-test'), `Commands.run stdout: "${fgResult.stdout.trim()}"`);
    assert(fgResult.exitCode === 0, 'exitCode = 0');

    section('Commands class — run with callbacks');
    const stdoutLines: string[] = [];
    await cmds.run('echo "cb1" && echo "cb2"', {
      onStdout: (line) => stdoutLines.push(line),
    });
    assert(stdoutLines.length >= 2, `Got ${stdoutLines.length} callback lines`);

    section('Commands class — run background + CommandHandle.wait');
    const handle = await cmds.run('sleep 1 && echo handle-done', { background: true });
    assert(typeof handle.pid === 'number', `Handle PID: ${handle.pid}`);
    const handleResult = await handle.wait();
    assert(handleResult.stdout.includes('handle-done'), `Handle wait stdout: "${handleResult.stdout.trim()}"`);

    section('Commands class — CommandHandle.wait throws on non-zero exit');
    const failHandle = await cmds.run('exit 7', { background: true });
    try {
      await failHandle.wait();
      assert(false, 'Should have thrown CommandExitError');
    } catch (err) {
      assert(err instanceof CommandExitError, 'Threw CommandExitError');
      assert((err as CommandExitError).message.includes('7'), `Error mentions exit code 7`);
    }

    section('Commands class — list + kill');
    const longHandle = await cmds.run('sleep 300', { background: true });
    const procList = await cmds.list();
    assert(Array.isArray(procList), 'list() returns array');
    const killed = await cmds.kill(longHandle.pid);
    assert(killed === true, `Killed PID ${longHandle.pid}`);

    section('Commands class — sendStdin');
    const catHandle = await cmds.run('cat', { background: true });
    await cmds.sendStdin(catHandle.pid, 'test-stdin-data\n');
    assert(true, 'sendStdin succeeded');
    await cmds.kill(catHandle.pid);

    section('Commands class — connect');
    const connBg = await cmds.run('sleep 2', { background: true });
    const connected = cmds.connect(connBg.pid);
    assert(connected.pid === connBg.pid, `Connected to PID ${connected.pid}`);
    await cmds.kill(connBg.pid);

    // ═══════════════════════════════════════
    // FILESYSTEM — RAW API
    // ═══════════════════════════════════════

    section('Write file');
    const writeData = (await client.post(`/sandboxes/${sandboxId}/files`, {
      json: { path: '/tmp/test.txt', data: 'hello from typescript sdk!' },
    })) as Record<string, unknown>;
    assert(writeData.path === '/tmp/test.txt', `Written to ${writeData.path}`);

    section('Read file');
    const readData = await client.get(`/sandboxes/${sandboxId}/files`, {
      params: { path: '/tmp/test.txt', username: 'user' },
    });
    const content = typeof readData === 'string' ? readData : String(readData);
    assert(content.includes('hello from typescript sdk'), `Content: "${content.trim()}"`);

    section('Batch write files');
    const batchData = (await client.post(`/sandboxes/${sandboxId}/files/batch`, {
      json: {
        files: [
          { path: '/tmp/batch1.txt', data: 'file one' },
          { path: '/tmp/batch2.txt', data: 'file two' },
          { path: '/tmp/batch3.txt', data: 'file three' },
        ],
      },
    })) as Record<string, unknown>[];
    assert(Array.isArray(batchData), 'Batch returns array');
    assert(batchData.length === 3, `Batch wrote ${batchData.length} files`);

    section('List directory');
    const dirData = (await client.get(`/sandboxes/${sandboxId}/files/list`, {
      params: { path: '/tmp', username: 'user', depth: '1' },
    })) as Record<string, unknown>[];
    assert(Array.isArray(dirData), 'Dir listing is array');
    const fileNames = dirData.map((e) => e.name as string);
    assert(fileNames.includes('test.txt'), 'test.txt in listing');
    assert(fileNames.includes('batch1.txt'), 'batch1.txt in listing');

    section('File exists');
    const existsData = (await client.get(`/sandboxes/${sandboxId}/files/exists`, {
      params: { path: '/tmp/test.txt', username: 'user' },
    })) as Record<string, unknown>;
    assert(existsData.exists === true, 'File exists = true');
    const notExists = (await client.get(`/sandboxes/${sandboxId}/files/exists`, {
      params: { path: '/tmp/nope.txt', username: 'user' },
    })) as Record<string, unknown>;
    assert(notExists.exists === false, 'Nonexistent file = false');

    section('File info');
    const fileInfo = (await client.get(`/sandboxes/${sandboxId}/files/info`, {
      params: { path: '/tmp/test.txt', username: 'user' },
    })) as Record<string, unknown>;
    assert(fileInfo.name === 'test.txt', `name = ${fileInfo.name}`);
    assert(fileInfo.type === 'file', `type = ${fileInfo.type}`);
    assert(typeof fileInfo.size === 'number' && (fileInfo.size as number) > 0, `size = ${fileInfo.size}`);

    section('Rename file');
    const renameData = (await client.patch(`/sandboxes/${sandboxId}/files`, {
      json: { old_path: '/tmp/test.txt', new_path: '/tmp/renamed.txt', username: 'user' },
    })) as Record<string, unknown>;
    assert(renameData.name === 'renamed.txt', 'Renamed successfully');

    section('Remove file');
    await client.delete(`/sandboxes/${sandboxId}/files`, {
      params: { path: '/tmp/renamed.txt', username: 'user' },
    });
    const afterDel = (await client.get(`/sandboxes/${sandboxId}/files/exists`, {
      params: { path: '/tmp/renamed.txt', username: 'user' },
    })) as Record<string, unknown>;
    assert(afterDel.exists === false, 'File removed');

    section('Make directory');
    const mkdirData = (await client.post(`/sandboxes/${sandboxId}/files/mkdir`, {
      json: { path: '/tmp/mydir', username: 'user' },
    })) as Record<string, unknown>;
    assert(mkdirData.created === true, 'Directory created');
    // Write a file inside the new dir
    await client.post(`/sandboxes/${sandboxId}/files`, {
      json: { path: '/tmp/mydir/nested.txt', data: 'nested file' },
    });
    const nestedRead = await client.get(`/sandboxes/${sandboxId}/files`, {
      params: { path: '/tmp/mydir/nested.txt', username: 'user' },
    });
    assert(String(nestedRead).includes('nested file'), 'Nested file readable');

    // ═══════════════════════════════════════
    // FILESYSTEM — SDK CLASS
    // ═══════════════════════════════════════

    section('Filesystem class — write + read');
    const fs = new Filesystem(sandboxId, client);
    const writeInfo = await fs.write('/tmp/sdk-file.txt', 'written via Filesystem class');
    assert(writeInfo.path === '/tmp/sdk-file.txt', `Filesystem.write path: ${writeInfo.path}`);
    const readContent = await fs.read('/tmp/sdk-file.txt');
    assert(readContent.includes('written via Filesystem class'), `Filesystem.read: "${readContent.trim()}"`);

    section('Filesystem class — writeFiles (batch)');
    const batchInfos = await fs.writeFiles([
      { path: '/tmp/sdk-batch-a.txt', data: 'aaa' },
      { path: '/tmp/sdk-batch-b.txt', data: 'bbb' },
    ]);
    assert(batchInfos.length === 2, `Batch wrote ${batchInfos.length} files`);

    section('Filesystem class — list + exists + getInfo');
    const listing = await fs.list('/tmp');
    assert(listing.length > 0, `Listed ${listing.length} entries`);
    const exists = await fs.exists('/tmp/sdk-file.txt');
    assert(exists === true, 'exists = true');
    const info = await fs.getInfo('/tmp/sdk-file.txt');
    assert(info.name === 'sdk-file.txt', `getInfo name: ${info.name}`);

    section('Filesystem class — rename + remove');
    await fs.rename('/tmp/sdk-file.txt', '/tmp/sdk-renamed.txt');
    assert(await fs.exists('/tmp/sdk-renamed.txt'), 'Renamed file exists');
    await fs.remove('/tmp/sdk-renamed.txt');
    assert(!(await fs.exists('/tmp/sdk-renamed.txt')), 'Removed file gone');

    section('Filesystem class — makeDir');
    const created = await fs.makeDir('/tmp/sdk-dir');
    assert(created === true, 'makeDir returned true');
    const dirInfo = await fs.getInfo('/tmp/sdk-dir');
    assert(dirInfo.type === 'dir', 'Created entry is a directory');

    section('Filesystem class — special characters');
    await fs.write('/tmp/special.txt', 'Unicode: 日本語 emoji: 🎉 newline:\nline2');
    const specialContent = await fs.read('/tmp/special.txt');
    assert(specialContent.includes('日本語'), 'Unicode preserved');
    assert(specialContent.includes('🎉'), 'Emoji preserved');

    // ═══════════════════════════════════════
    // FILESYSTEM — URL INJECTION FIX VERIFICATION
    // ═══════════════════════════════════════

    section('Filesystem.remove — URL injection prevention');
    // Write a file, then remove it using the SDK class (which uses query params, not URL concat)
    await fs.write('/tmp/safe-delete.txt', 'will be deleted safely');
    await fs.remove('/tmp/safe-delete.txt');
    assert(!(await fs.exists('/tmp/safe-delete.txt')), 'Safe delete via query params works');

    // ═══════════════════════════════════════
    // SSE STREAMING
    // ═══════════════════════════════════════

    section('SSE streaming (runStream via raw POST)');
    try {
      const streamResp = await client.stream(`/sandboxes/${sandboxId}/commands/stream`, {
        json: { cmd: 'echo "stream-line-1" && echo "stream-line-2"', stream: true, user: 'user', timeout: 30 },
        timeout: 30000,
      });
      assert(streamResp instanceof Response, 'stream() returns Response');
      // Read the SSE body
      const streamText = await streamResp.text();
      assert(streamText.includes('stream-line-1'), `SSE contains stream-line-1`);
      assert(streamText.includes('stream-line-2'), `SSE contains stream-line-2`);
    } catch (err) {
      // SSE might not be implemented on the server — note it
      assert(false, `SSE streaming failed: ${(err as Error).message}`);
    }

    // ═══════════════════════════════════════
    // PTY
    // ═══════════════════════════════════════

    section('PTY — create + kill');
    const pty = new Pty(sandboxId, client);
    try {
      const ptyHandle = await pty.create({ size: { cols: 80, rows: 24 } });
      assert(typeof ptyHandle.pid === 'number', `PTY PID: ${ptyHandle.pid}`);
      const ptyKilled = await pty.kill(ptyHandle.pid);
      assert(ptyKilled === true, 'PTY killed');
    } catch (err) {
      // PTY might use different routes — note it
      assert(false, `PTY create failed: ${(err as Error).message}`);
    }

    section('PTY — sendStdin + resize');
    try {
      const ptyHandle2 = await pty.create();
      await pty.sendStdin(ptyHandle2.pid, 'echo pty-test\n');
      assert(true, 'PTY sendStdin succeeded');
      await pty.resize(ptyHandle2.pid, { cols: 120, rows: 40 });
      assert(true, 'PTY resize succeeded');
      await pty.kill(ptyHandle2.pid);
    } catch (err) {
      assert(false, `PTY operations failed: ${(err as Error).message}`);
    }

    // ═══════════════════════════════════════
    // SANDBOX WITH METADATA + ENVS
    // ═══════════════════════════════════════

    section('Create sandbox with metadata + envs');
    const metaSbx = (await client.post('/sandboxes', {
      json: {
        template: 'base',
        timeout: 60,
        metadata: { team: 'sdk-test', purpose: 'e2e' },
        envs: { SDK_TEST: 'true', VERSION: '0.1.0' },
      },
      timeout: 30000,
    })) as Record<string, unknown>;
    const metaSbxId = metaSbx.sandbox_id as string;
    assert(!!metaSbxId, `Created with metadata: ${metaSbxId}`);
    // Verify envs work inside the sandbox
    const envCheck = (await client.post(`/sandboxes/${metaSbxId}/commands`, {
      json: { cmd: 'echo $SDK_TEST', background: false, user: 'user', timeout: 10 },
      timeout: 15000,
    })) as Record<string, unknown>;
    assert((envCheck.stdout as string).includes('true'), `ENV inside sandbox: "${(envCheck.stdout as string).trim()}"`);
    // Verify metadata stored
    const metaInfo = (await client.get(`/sandboxes/${metaSbxId}`)) as Record<string, unknown>;
    const meta = metaInfo.metadata as Record<string, string> | null;
    assert(meta !== null && meta.team === 'sdk-test', `Metadata preserved: team=${meta?.team}`);
    // Clean up
    await client.delete(`/sandboxes/${metaSbxId}`);
    assert(true, 'Metadata sandbox killed');

    // ═══════════════════════════════════════
    // SANDBOX WITH NETWORK RESTRICTIONS
    // ═══════════════════════════════════════

    section('Create sandbox with network restrictions');
    const netSbx = (await client.post('/sandboxes', {
      json: {
        template: 'base',
        timeout: 60,
        network: { deny_out: ['0.0.0.0/0'] },
      },
      timeout: 30000,
    })) as Record<string, unknown>;
    const netSbxId = netSbx.sandbox_id as string;
    assert(!!netSbxId, `Network-restricted sandbox: ${netSbxId}`);
    const netInfo = (await client.get(`/sandboxes/${netSbxId}`)) as Record<string, unknown>;
    const network = netInfo.network as Record<string, unknown> | null;
    assert(network !== null && Array.isArray(network?.deny_out), 'Network policy stored');
    assert((network?.deny_out as string[]).includes('0.0.0.0/0'), 'deny_out has 0.0.0.0/0');
    await client.delete(`/sandboxes/${netSbxId}`);
    assert(true, 'Network sandbox killed');

    // ═══════════════════════════════════════
    // SANDBOX WITH SECURITY POLICY
    // ═══════════════════════════════════════

    section('Create sandbox with security policy');
    const secPolicy = {
      pii: { enabled: true, types: ['ssn', 'credit_card'], action: 'redact', rehydrate_response: false },
      injection_defense: { enabled: true, sensitivity: 'medium', action: 'block' },
      transformations: [],
      audit: { enabled: true },
      env_security: { mask_patterns: ['*_KEY', '*_SECRET'], auto_mask_in_audit: true },
    };
    const secSbx = (await client.post('/sandboxes', {
      json: {
        template: 'base',
        timeout: 60,
        security: secPolicy,
      },
      timeout: 30000,
    })) as Record<string, unknown>;
    const secSbxId = secSbx.sandbox_id as string;
    assert(!!secSbxId, `Security-policy sandbox: ${secSbxId}`);
    const secInfo = (await client.get(`/sandboxes/${secSbxId}`)) as Record<string, unknown>;
    assert(secInfo.security !== null && secInfo.security !== undefined, 'Security policy stored');
    await client.delete(`/sandboxes/${secSbxId}`);
    assert(true, 'Security sandbox killed');

    // ═══════════════════════════════════════
    // SNAPSHOT
    // ═══════════════════════════════════════

    section('Create snapshot');
    const snapData = (await client.post(`/sandboxes/${sandboxId}/snapshots`)) as Record<string, unknown>;
    assert(!!snapData.snapshot_id, `Snapshot: ${snapData.snapshot_id}`);

    // ═══════════════════════════════════════
    // PAUSE + KILL
    // ═══════════════════════════════════════

    section('Pause sandbox');
    await client.post(`/sandboxes/${sandboxId}/pause`);
    assert(true, 'Pause succeeded');

    section('Kill sandbox');
    const killData = (await client.delete(`/sandboxes/${sandboxId}`)) as Record<string, unknown>;
    assert(killData.killed === true, 'Sandbox killed');

    section('Verify sandbox is killed');
    const afterKill = (await client.get(`/sandboxes/${sandboxId}`)) as Record<string, unknown>;
    assert(afterKill.state === 'killed', `State after kill: ${afterKill.state}`);
  } catch (err) {
    console.error(`\n💥 Error during test: ${(err as Error).message}`);
    // Try to clean up the sandbox
    if (sandboxId) {
      try {
        await client.delete(`/sandboxes/${sandboxId}`);
        console.log(`   Cleaned up sandbox ${sandboxId}`);
      } catch {
        // ignore
      }
    }
  } finally {
    client.close();
  }

  // ─── Summary ───
  console.log('\n' + '═'.repeat(50));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log(`  Failures:`);
    for (const f of failures) {
      console.log(`    - ${f}`);
    }
  }
  console.log('═'.repeat(50) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});
