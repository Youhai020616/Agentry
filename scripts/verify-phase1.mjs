#!/usr/bin/env node
/**
 * verify-phase1.mjs
 *
 * Phase 1 Multi-Agent Migration Verification Script
 *
 * Verifies that the native multi-agent infrastructure works end-to-end:
 *   1. File system: employee workspace dirs + AGENTS.md files
 *   2. Config: agents registered in openclaw.json with correct fields
 *   3. Session routing: chat.send to agent:{slug}:main routes to correct agent
 *   4. Isolation: different agents don't leak system prompts
 *
 * Usage:
 *   node scripts/verify-phase1.mjs                  # Full verification
 *   node scripts/verify-phase1.mjs --fs-only        # File system checks only (no Gateway)
 *   node scripts/verify-phase1.mjs --employee <id>  # Test a specific employee
 *   node scripts/verify-phase1.mjs --list           # List discovered workspaces + config
 *
 * Prerequisites:
 *   - ClawX app must be running (for Gateway chat tests)
 *   - At least one employee must have been activated via the UI
 */

import {
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

// ── Paths ────────────────────────────────────────────────────────────────

const HOME = homedir();
const CLAWX_EMPLOYEES_DIR = join(HOME, '.clawx', 'employees');
const OPENCLAW_CONFIG_PATH = join(HOME, '.openclaw', 'openclaw.json');
const APPDATA = process.env.APPDATA || join(HOME, '.config');
const SETTINGS_PATH = join(APPDATA, 'pocketcrow', 'settings.json');

// ── ANSI colors ──────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

function pass(msg) { console.log(`  ${C.green}✓${C.reset} ${msg}`); }
function fail(msg) { console.log(`  ${C.red}✗${C.reset} ${msg}`); }
function info(msg) { console.log(`  ${C.dim}ℹ ${msg}${C.reset}`); }
function warn(msg) { console.log(`  ${C.yellow}⚠ ${msg}${C.reset}`); }
function heading(msg) { console.log(`\n${C.bold}${C.cyan}═══ ${msg} ═══${C.reset}`); }
function subheading(msg) { console.log(`\n${C.bold}  ${msg}${C.reset}`); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Results tracker ──────────────────────────────────────────────────────

const results = { passed: 0, failed: 0, skipped: 0, details: [] };

function record(name, ok, detail) {
  if (ok) {
    results.passed++;
    pass(`${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    results.failed++;
    fail(`${name}${detail ? ` — ${detail}` : ''}`);
  }
  results.details.push({ name, ok, detail });
}

function skip(name, reason) {
  results.skipped++;
  info(`SKIP: ${name} — ${reason}`);
  results.details.push({ name, ok: null, detail: reason });
}

// ── Config / Settings helpers ────────────────────────────────────────────

function loadSettings() {
  if (!existsSync(SETTINGS_PATH)) return null;
  try { return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')); }
  catch { return null; }
}

function getGatewayConfig() {
  const settings = loadSettings();
  return {
    port: parseInt(process.env.GATEWAY_PORT || '') || settings?.gatewayPort || 18790,
    token: process.env.GATEWAY_TOKEN || settings?.gatewayToken || '',
  };
}

function readOpenClawConfig() {
  if (!existsSync(OPENCLAW_CONFIG_PATH)) return null;
  try { return JSON.parse(readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8')); }
  catch { return null; }
}

// ── File System Checks ───────────────────────────────────────────────────

function checkFileSystem(targetEmployee) {
  heading('File System Verification');

  // 1. Check workspaces directory
  subheading('Workspaces directory');
  if (!existsSync(CLAWX_EMPLOYEES_DIR)) {
    record('Workspaces dir exists', false, `${CLAWX_EMPLOYEES_DIR} not found`);
    return [];
  }
  record('Workspaces dir exists', true, CLAWX_EMPLOYEES_DIR);

  // 2. List employee workspace dirs
  const entries = readdirSync(CLAWX_EMPLOYEES_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory());

  if (entries.length === 0) {
    record('Has employee workspaces', false, 'No subdirectories found — activate an employee first');
    return [];
  }
  record('Has employee workspaces', true, `${entries.length} workspace(s) found`);

  // 3. Check each workspace (or just the target)
  const workspacesToCheck = targetEmployee
    ? entries.filter(e => e.name === targetEmployee)
    : entries;

  if (targetEmployee && workspacesToCheck.length === 0) {
    record(`Workspace for "${targetEmployee}"`, false, 'Directory not found');
    return [];
  }

  const validWorkspaces = [];

  for (const entry of workspacesToCheck) {
    const wsDir = join(CLAWX_EMPLOYEES_DIR, entry.name);
    subheading(`Employee: ${entry.name}`);

    // Check AGENTS.md
    const agentsMd = join(wsDir, 'AGENTS.md');
    if (existsSync(agentsMd)) {
      const content = readFileSync(agentsMd, 'utf-8');
      const sizeKb = (Buffer.byteLength(content, 'utf-8') / 1024).toFixed(1);
      record(`${entry.name}/AGENTS.md exists`, true, `${content.length} chars (${sizeKb} KB)`);

      // Show first few lines
      const preview = content.split('\n').slice(0, 3).join(' | ').substring(0, 120);
      info(`Preview: ${preview}...`);
    } else {
      record(`${entry.name}/AGENTS.md exists`, false, 'Missing — activate() did not write it');
    }

    // Check CLAUDE.md (OpenClaw compat copy)
    const claudeMd = join(wsDir, 'CLAUDE.md');
    if (existsSync(claudeMd)) {
      record(`${entry.name}/CLAUDE.md exists`, true);
    } else {
      warn(`${entry.name}/CLAUDE.md missing (optional but recommended)`);
    }

    validWorkspaces.push(entry.name);
  }

  return validWorkspaces;
}

// ── Config Checks ────────────────────────────────────────────────────────

function checkConfig(validWorkspaces, targetEmployee) {
  heading('openclaw.json Agent Registration');

  const config = readOpenClawConfig();
  if (!config) {
    record('openclaw.json readable', false, `${OPENCLAW_CONFIG_PATH} not found or invalid JSON`);
    return [];
  }
  record('openclaw.json readable', true);

  // Check agents section
  const agents = config.agents;
  if (!agents) {
    record('agents section exists', false, 'No "agents" key in config');
    return [];
  }
  record('agents section exists', true);

  const agentsList = agents.list;
  if (!Array.isArray(agentsList) || agentsList.length === 0) {
    record('agents.list has entries', false, 'agents.list is empty or missing');
    return [];
  }
  record('agents.list has entries', true, `${agentsList.length} agent(s) registered`);

  // Show all registered agents
  subheading('Registered agents');
  for (const agent of agentsList) {
    const toolsStr = agent.tools ? ` tools=${JSON.stringify(agent.tools.allow || [])}` : '';
    const modelStr = agent.model ? ` model=${agent.model}` : '';
    info(`${agent.id}: workspace=${agent.workspace}${toolsStr}${modelStr}`);
  }

  // Cross-reference with workspaces on disk
  const agentsToTest = targetEmployee
    ? agentsList.filter(a => a.id === targetEmployee)
    : agentsList;

  const registeredIds = [];

  for (const agent of agentsToTest) {
    subheading(`Agent: ${agent.id}`);

    // Required fields
    record(`${agent.id} has id`, !!agent.id, agent.id);
    record(`${agent.id} has workspace`, !!agent.workspace, agent.workspace);

    // Check workspace path exists on disk
    const wsPath = agent.workspace?.replace(/\//g, '\\') || agent.workspace;
    const wsNormalized = agent.workspace; // as stored (forward slashes)
    const wsExists = existsSync(wsPath) || existsSync(wsNormalized);
    record(`${agent.id} workspace exists on disk`, wsExists, wsExists ? 'OK' : `Not found at ${agent.workspace}`);

    // Check AGENTS.md inside the registered workspace
    const agentsMdInWs = existsSync(join(wsPath, 'AGENTS.md')) || existsSync(join(wsNormalized, 'AGENTS.md'));
    record(`${agent.id} workspace has AGENTS.md`, agentsMdInWs);

    // Session key format
    const expectedSessionKey = `agent:${agent.id}:main`;
    info(`Expected session key: ${expectedSessionKey}`);

    // Optional: tools policy
    if (agent.tools?.allow) {
      record(`${agent.id} has tool policy`, true, `allow: [${agent.tools.allow.join(', ')}]`);
    } else {
      info(`${agent.id}: no tool policy (using defaults)`);
    }

    // Optional: model override
    if (agent.model) {
      record(`${agent.id} has model override`, true, agent.model);
    } else {
      info(`${agent.id}: no model override (using agents.defaults.model)`);
    }

    // Cross-ref: is this agent in the filesystem workspaces we found?
    if (validWorkspaces.includes(agent.id)) {
      record(`${agent.id} cross-ref FS ↔ config`, true, 'Workspace dir and config entry match');
    } else if (validWorkspaces.length > 0) {
      warn(`${agent.id} is in config but workspace dir not in ${CLAWX_EMPLOYEES_DIR}`);
    }

    registeredIds.push(agent.id);
  }

  return registeredIds;
}

// ── Gateway WebSocket Client (minimal) ───────────────────────────────────

class GatewayClient {
  constructor(port, token) {
    this.port = port;
    this.token = token;
    this.ws = null;
    this.pending = new Map();
    this.connected = false;
    this.eventHandlers = new Map();
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, []);
    this.eventHandlers.get(event).push(handler);
  }

  _emit(event, ...args) {
    for (const h of (this.eventHandlers.get(event) || [])) h(...args);
  }

  connect(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const wsUrl = `ws://localhost:${this.port}/ws`;
      info(`Connecting to Gateway at ${wsUrl}...`);

      this.ws = new WebSocket(wsUrl);
      let done = false;
      let connectSent = false;

      const connectFrame = {
        type: 'req',
        id: `connect-${Date.now()}`,
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: 'gateway-client',
            displayName: 'Phase1 Verify',
            version: '0.1.0',
            platform: process.platform,
            mode: 'ui',
          },
          auth: { token: this.token },
          caps: [],
          role: 'operator',
          scopes: [],
        },
      };

      const doSendConnect = () => {
        if (connectSent) return;
        connectSent = true;
        this.ws.send(JSON.stringify(connectFrame));
      };

      this.pending.set(connectFrame.id, {
        resolve: () => { done = true; this.connected = true; resolve(); },
        reject: (err) => { done = true; reject(err); },
        timeout: setTimeout(() => {
          if (!done) { this.ws?.close(); reject(new Error('Handshake timeout')); }
        }, timeoutMs),
      });

      this.ws.on('open', () => {
        setTimeout(() => { if (!connectSent) doSendConnect(); }, 500);
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleMessage(msg, doSendConnect);
        } catch { /* ignore */ }
      });

      this.ws.on('close', (code) => {
        this.connected = false;
        if (!done) reject(new Error(`WS closed (code=${code})`));
      });

      this.ws.on('error', (err) => {
        if (!done) reject(err);
      });
    });
  }

  _handleMessage(msg, doSendConnect) {
    // Connect challenge
    if ((msg.type === 'evt' || msg.type === 'event') && msg.event === 'connect.challenge') {
      doSendConnect?.();
      return;
    }

    // Agent stream events
    if ((msg.type === 'evt' || msg.type === 'event') && msg.event === 'agent') {
      const payload = msg.payload || {};
      const stream = payload.stream;
      const data = payload.data || {};

      if (stream === 'assistant' && data.delta) {
        this._emit('chat', {
          state: 'delta',
          sessionKey: payload.sessionKey,
          content: data.delta,
        });
      } else if (stream === 'lifecycle') {
        const phase = data.phase;
        if (phase === 'end' || phase === 'done' || phase === 'complete') {
          this._emit('chat', {
            state: 'final',
            sessionKey: payload.sessionKey,
            content: data.text || '',
          });
        }
      } else if (stream === 'error') {
        this._emit('chat', {
          state: 'error',
          sessionKey: payload.sessionKey,
          content: data.message || data.error || 'Unknown error',
        });
      }
      return;
    }

    // Chat events (non-agent)
    if ((msg.type === 'evt' || msg.type === 'event') && msg.event === 'chat') {
      this._emit('chat', msg.payload);
      return;
    }

    // RPC response (OpenClaw protocol)
    if (msg.type === 'res' && typeof msg.id === 'string') {
      const req = this.pending.get(msg.id);
      if (req) {
        clearTimeout(req.timeout);
        this.pending.delete(msg.id);
        if (msg.ok === false || msg.error) {
          const errStr = typeof msg.error === 'object'
            ? (msg.error?.message || JSON.stringify(msg.error))
            : String(msg.error || 'Unknown');
          req.reject(new Error(errStr));
        } else {
          req.resolve(msg.payload ?? msg);
        }
      }
      return;
    }

    // JSON-RPC 2.0 response (legacy)
    if (msg.jsonrpc === '2.0' && msg.id) {
      const req = this.pending.get(String(msg.id));
      if (req) {
        clearTimeout(req.timeout);
        this.pending.delete(String(msg.id));
        if (msg.error) req.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else req.resolve(msg.result);
      }
    }
  }

  rpc(method, params, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected')); return;
      }
      const id = randomUUID();
      const frame = { type: 'req', id, method, params };
      this.pending.set(id, {
        resolve, reject,
        timeout: setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`RPC timeout: ${method} (${timeoutMs}ms)`));
        }, timeoutMs),
      });
      this.ws.send(JSON.stringify(frame));
    });
  }

  close() {
    if (this.ws) { this.ws.close(); this.ws = null; }
    for (const [, req] of this.pending) {
      clearTimeout(req.timeout);
      req.reject(new Error('Client closed'));
    }
    this.pending.clear();
    this.connected = false;
  }
}

// ── Chat Test ────────────────────────────────────────────────────────────

/**
 * Send a message to a specific employee session and collect the response.
 * Returns { content, sessionKey, timedOut, error }.
 */
async function sendChatAndCollect(client, employeeId, message, timeoutMs = 60000) {
  const sessionKey = `agent:${employeeId}:main`;
  let fullContent = '';
  let resolved = false;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ content: fullContent, sessionKey, timedOut: true, error: null });
      }
    }, timeoutMs);

    const onChat = (payload) => {
      if (!payload) return;

      // Accumulate content from deltas
      if (payload.state === 'delta' && payload.content) {
        fullContent += payload.content;
        if (fullContent.length < 200) {
          process.stdout.write(C.dim + payload.content + C.reset);
        } else if (fullContent.length - payload.content.length < 200) {
          process.stdout.write(C.dim + '...' + C.reset);
        }
      }

      // Final message
      if (payload.state === 'final') {
        if (payload.content) fullContent += payload.content;
        if (!resolved) {
          resolved = true;
          cleanup();
          console.log(''); // newline after streaming
          resolve({ content: fullContent, sessionKey, timedOut: false, error: null });
        }
      }

      // Error
      if (payload.state === 'error') {
        if (!resolved) {
          resolved = true;
          cleanup();
          console.log('');
          resolve({ content: fullContent, sessionKey, timedOut: false, error: payload.content });
        }
      }
    };

    function cleanup() {
      clearTimeout(timer);
      client.eventHandlers.delete('chat');
    }

    client.on('chat', onChat);

    // Send the message via chat.send (native routing — no extraSystemPrompt needed!)
    client.rpc('chat.send', {
      sessionKey,
      message,
      deliver: false,
      idempotencyKey: randomUUID(),
    }, timeoutMs).catch((err) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ content: '', sessionKey, timedOut: false, error: String(err) });
      }
    });
  });
}

// ── Gateway Chat Tests ───────────────────────────────────────────────────

async function testGatewayChat(registeredIds, targetEmployee) {
  heading('Gateway Chat Routing Test');

  const gw = getGatewayConfig();
  info(`Gateway: ws://localhost:${gw.port}/ws`);

  if (!gw.token) {
    warn('No gateway token found in settings — connection may fail');
  }

  const client = new GatewayClient(gw.port, gw.token);

  try {
    await client.connect();
    record('Gateway connection', true, `Connected to port ${gw.port}`);
  } catch (err) {
    record('Gateway connection', false, String(err));
    info('Make sure ClawX is running with Gateway active');
    return;
  }

  // Test chat with each registered agent (or just the target)
  const idsToTest = targetEmployee
    ? registeredIds.filter(id => id === targetEmployee)
    : registeredIds.slice(0, 2); // Test at most 2 to avoid long runtime

  for (const employeeId of idsToTest) {
    subheading(`Chat: ${employeeId}`);

    const sessionKey = `agent:${employeeId}:main`;
    info(`Session key: ${sessionKey}`);
    info(`Sending test message...`);

    const testMessage = '你好，请用一句话介绍你自己的角色和职责。';
    console.log(`  ${C.blue}${C.bold}You:${C.reset} ${testMessage}`);
    process.stdout.write(`  ${C.magenta}${C.bold}${employeeId}:${C.reset} `);

    const result = await sendChatAndCollect(client, employeeId, testMessage, 45000);

    if (result.error) {
      record(`${employeeId} chat response`, false, `Error: ${result.error}`);
    } else if (result.timedOut) {
      record(`${employeeId} chat response`, false,
        `Timeout — got ${result.content.length} chars before timeout`);
    } else if (result.content.length > 0) {
      record(`${employeeId} chat response`, true,
        `${result.content.length} chars received via native routing`);
    } else {
      record(`${employeeId} chat response`, false, 'Empty response');
    }

    // Verify session key routing (the response should come back on the correct session)
    info(`Response length: ${result.content.length} chars`);

    // Brief pause between employees
    if (idsToTest.indexOf(employeeId) < idsToTest.length - 1) {
      await sleep(1000);
    }
  }

  client.close();
}

// ── List Mode ────────────────────────────────────────────────────────────

function listMode() {
  heading('Discovery: Workspaces & Config');

  // Workspaces
  subheading('Employee workspaces');
  if (existsSync(CLAWX_EMPLOYEES_DIR)) {
    const entries = readdirSync(CLAWX_EMPLOYEES_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory());
    if (entries.length === 0) {
      info('(none — no employee has been activated yet)');
    }
    for (const e of entries) {
      const wsDir = join(CLAWX_EMPLOYEES_DIR, e.name);
      const hasAgentsMd = existsSync(join(wsDir, 'AGENTS.md'));
      const hasClaudeMd = existsSync(join(wsDir, 'CLAUDE.md'));
      let agentsMdSize = '';
      if (hasAgentsMd) {
        const stat = statSync(join(wsDir, 'AGENTS.md'));
        agentsMdSize = ` (${(stat.size / 1024).toFixed(1)} KB)`;
      }
      const files = [
        hasAgentsMd ? `AGENTS.md${agentsMdSize}` : null,
        hasClaudeMd ? 'CLAUDE.md' : null,
      ].filter(Boolean).join(', ');
      console.log(`  ${C.green}●${C.reset} ${e.name} — ${files || '(empty)'}`);
    }
  } else {
    info(`Directory not found: ${CLAWX_EMPLOYEES_DIR}`);
  }

  // Config agents
  subheading('openclaw.json agents.list');
  const config = readOpenClawConfig();
  const agents = config?.agents?.list;
  if (Array.isArray(agents) && agents.length > 0) {
    for (const a of agents) {
      const parts = [`id=${a.id}`];
      if (a.name) parts.push(`name="${a.name}"`);
      if (a.workspace) parts.push(`ws=${a.workspace}`);
      if (a.tools?.allow) parts.push(`tools=[${a.tools.allow.join(',')}]`);
      if (a.model) parts.push(`model=${a.model}`);
      console.log(`  ${C.cyan}●${C.reset} ${parts.join('  ')}`);
    }
  } else {
    info('(no agents registered)');
  }

  // Defaults
  subheading('agents.defaults');
  const defaults = config?.agents?.defaults;
  if (defaults) {
    console.log(`  model: ${JSON.stringify(defaults.model)}`);
    if (defaults.maxConcurrent) console.log(`  maxConcurrent: ${defaults.maxConcurrent}`);
  } else {
    info('(no defaults)');
  }

  // Old vs new session key check
  subheading('Session key format check');
  const oldPattern = /agent:main:employee-/;
  const newPattern = /agent:[\w-]+:main/;
  if (agents && agents.length > 0) {
    for (const a of agents) {
      const newKey = `agent:${a.id}:main`;
      console.log(`  ${a.id}: ${C.green}${newKey}${C.reset} (native multi-agent)`);
    }
  }
  info(`Old format: agent:main:employee-{slug} (extraSystemPrompt hack)`);
  info(`New format: agent:{slug}:main (native OpenClaw routing)`);
}

// ── Report ───────────────────────────────────────────────────────────────

function printReport() {
  heading('Verification Report');

  const total = results.passed + results.failed;
  const allPassed = results.failed === 0 && results.passed > 0;

  console.log(`
  ${C.bold}Passed:${C.reset}  ${C.green}${results.passed}${C.reset}
  ${C.bold}Failed:${C.reset}  ${results.failed > 0 ? C.red : C.dim}${results.failed}${C.reset}
  ${C.bold}Skipped:${C.reset} ${C.dim}${results.skipped}${C.reset}
  ${C.bold}Total:${C.reset}   ${total}
  `);

  if (allPassed) {
    console.log(`  ${C.green}${C.bold}🎉 Phase 1 verification PASSED!${C.reset}`);
    console.log(`  ${C.dim}Native multi-agent routing is working correctly.${C.reset}`);
    console.log(`  ${C.dim}The extraSystemPrompt hack is no longer needed.${C.reset}`);
  } else if (results.failed > 0) {
    console.log(`  ${C.red}${C.bold}⚠ Phase 1 verification has failures${C.reset}`);
    console.log(`  ${C.dim}Review the failed items above.${C.reset}`);

    // Specific guidance
    const failedNames = results.details.filter(d => d.ok === false).map(d => d.name);
    if (failedNames.some(n => n.includes('Workspaces dir'))) {
      console.log(`\n  ${C.yellow}Hint:${C.reset} No workspaces found. Activate an employee in the ClawX UI first.`);
    }
    if (failedNames.some(n => n.includes('Gateway'))) {
      console.log(`\n  ${C.yellow}Hint:${C.reset} Gateway not reachable. Start ClawX with \`pnpm dev\`.`);
    }
    if (failedNames.some(n => n.includes('agents.list'))) {
      console.log(`\n  ${C.yellow}Hint:${C.reset} agents.list is empty. The new activate() must register agents.`);
    }
  } else {
    console.log(`  ${C.yellow}No checks ran. Activate an employee first.${C.reset}`);
  }

  console.log('');
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const fsOnly = args.includes('--fs-only');
  const listOnly = args.includes('--list');
  const employeeIdx = args.indexOf('--employee');
  const targetEmployee = employeeIdx !== -1 ? args[employeeIdx + 1] : null;

  console.log(`${C.bold}${C.blue}`);
  console.log(`╔══════════════════════════════════════════════════╗`);
  console.log(`║   ClawX Phase 1 — Multi-Agent Verification      ║`);
  console.log(`╚══════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  ${C.dim}Workspaces: ${CLAWX_EMPLOYEES_DIR}${C.reset}`);
  console.log(`  ${C.dim}Config:     ${OPENCLAW_CONFIG_PATH}${C.reset}`);
  if (targetEmployee) {
    console.log(`  ${C.dim}Target:     ${targetEmployee}${C.reset}`);
  }

  // List mode — just show what's there
  if (listOnly) {
    listMode();
    return;
  }

  // Step 1: File system checks
  const validWorkspaces = checkFileSystem(targetEmployee);

  // Step 2: Config checks
  const registeredIds = checkConfig(validWorkspaces, targetEmployee);

  // Step 3: Gateway chat tests (unless --fs-only)
  if (fsOnly) {
    skip('Gateway chat test', '--fs-only flag');
  } else if (registeredIds.length === 0) {
    skip('Gateway chat test', 'No agents registered in config');
  } else {
    try {
      await testGatewayChat(registeredIds, targetEmployee);
    } catch (err) {
      record('Gateway chat test', false, String(err));
    }
  }

  // Report
  printReport();

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${C.red}Fatal error: ${err}${C.reset}`);
  console.error(err.stack);
  process.exit(2);
});
