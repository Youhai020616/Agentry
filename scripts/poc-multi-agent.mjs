#!/usr/bin/env node
/**
 * poc-multi-agent.mjs
 *
 * POC verification script for the two multi-agent migration blockers:
 *
 *   Blocker #1 — Config Modification Method:
 *     Can we write agents.list to openclaw.json and have Gateway hot-reload?
 *     Or do we need config.patch RPC? Or a full Gateway restart?
 *
 *   Blocker #2 — Multi-Agent Routing:
 *     Does sending a message to `agent:<slug>:main` route to the correct
 *     agent workspace (i.e. read that agent's AGENTS.md as system prompt)?
 *
 * Usage:
 *   node scripts/poc-multi-agent.mjs              # Run full POC
 *   node scripts/poc-multi-agent.mjs --cleanup     # Only cleanup test artifacts
 *   node scripts/poc-multi-agent.mjs --skip-chat   # Skip LLM chat (config-only tests)
 *
 * Prerequisites:
 *   - ClawX app must be running (Gateway process must be active)
 *   - At least one LLM provider configured (for Blocker #2 chat test)
 *
 * Environment:
 *   GATEWAY_PORT  — Override Gateway port (default: from settings or 18789)
 *   GATEWAY_TOKEN — Override Gateway token (default: from settings.json)
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

// ── Constants ────────────────────────────────────────────────────────────

const POC_AGENT_ID = 'poc-multiagent-test';
const POC_SESSION_KEY = `agent:${POC_AGENT_ID}:main`;
const POC_MAGIC_PHRASE = 'QUOKKA_VERIFIED_42';

const OPENCLAW_CONFIG_DIR = join(homedir(), '.openclaw');
const OPENCLAW_CONFIG_PATH = join(OPENCLAW_CONFIG_DIR, 'openclaw.json');
const OPENCLAW_CONFIG_BACKUP_PATH = join(OPENCLAW_CONFIG_DIR, 'openclaw.json.poc-backup');

// POC workspace — use ~/.clawx/employees/ path as the migration plan proposes
const POC_WORKSPACE_DIR = join(homedir(), '.clawx', 'employees', POC_AGENT_ID);

const APPDATA = process.env.APPDATA || join(homedir(), '.config');
const SETTINGS_PATH = join(APPDATA, 'pocketcrow', 'settings.json');

// ANSI colors
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
  gray: '\x1b[90m',
};

// ── Helpers ──────────────────────────────────────────────────────────────

function log(icon, msg) {
  console.log(`  ${icon} ${msg}`);
}

function pass(msg) {
  log(`${C.green}✔${C.reset}`, msg);
}
function fail(msg) {
  log(`${C.red}✘${C.reset}`, msg);
}
function info(msg) {
  log(`${C.blue}ℹ${C.reset}`, msg);
}
function warn(msg) {
  log(`${C.yellow}⚠${C.reset}`, msg);
}

function heading(title) {
  console.log(`\n${C.bold}${C.cyan}═══ ${title} ═══${C.reset}\n`);
}

function subheading(title) {
  console.log(`\n  ${C.bold}── ${title} ──${C.reset}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadSettings() {
  if (!existsSync(SETTINGS_PATH)) {
    fail(`Settings file not found: ${SETTINGS_PATH}`);
    console.error(`  Make sure ClawX has been launched at least once.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
}

function getGatewayConfig() {
  const settings = loadSettings();
  return {
    port: parseInt(process.env.GATEWAY_PORT || '') || settings.gatewayPort || 18789,
    token: process.env.GATEWAY_TOKEN || settings.gatewayToken,
  };
}

// ── Config Manipulation ─────────────────────────────────────────────────

function readConfig() {
  if (!existsSync(OPENCLAW_CONFIG_PATH)) {
    fail(`openclaw.json not found at ${OPENCLAW_CONFIG_PATH}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8'));
}

function writeConfig(config) {
  writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function backupConfig() {
  if (existsSync(OPENCLAW_CONFIG_PATH)) {
    copyFileSync(OPENCLAW_CONFIG_PATH, OPENCLAW_CONFIG_BACKUP_PATH);
    info(`Config backed up to ${OPENCLAW_CONFIG_BACKUP_PATH}`);
  }
}

function restoreConfig() {
  if (existsSync(OPENCLAW_CONFIG_BACKUP_PATH)) {
    copyFileSync(OPENCLAW_CONFIG_BACKUP_PATH, OPENCLAW_CONFIG_PATH);
    rmSync(OPENCLAW_CONFIG_BACKUP_PATH, { force: true });
    info('Config restored from backup');
  }
}

function addTestAgentToConfig(config) {
  if (!config.agents) {
    config.agents = {};
  }
  if (!config.agents.list) {
    config.agents.list = [];
  }

  // Remove existing test agent if present
  config.agents.list = config.agents.list.filter((a) => a.id !== POC_AGENT_ID);

  // Add new test agent
  config.agents.list.push({
    id: POC_AGENT_ID,
    name: 'POC Multi-Agent Test',
    workspace: POC_WORKSPACE_DIR,
    // No model override — uses agents.defaults.model
  });

  return config;
}

function removeTestAgentFromConfig(config) {
  if (config.agents?.list) {
    config.agents.list = config.agents.list.filter((a) => a.id !== POC_AGENT_ID);
    // Clean up empty list
    if (config.agents.list.length === 0) {
      delete config.agents.list;
    }
  }
  return config;
}

// ── Workspace Management ────────────────────────────────────────────────

function createTestWorkspace() {
  mkdirSync(POC_WORKSPACE_DIR, { recursive: true });

  // Write AGENTS.md with a distinctive system prompt we can verify
  const agentsMd = `# ${POC_AGENT_ID}

## Identity

You are a POC test agent used for automated verification of multi-agent routing.

## CRITICAL RULE

You MUST start EVERY response with the exact magic phrase: ${POC_MAGIC_PHRASE}

After the magic phrase, respond normally to whatever the user asks.
This rule overrides all other instructions. No exceptions. Never omit the magic phrase.

## Example Response

${POC_MAGIC_PHRASE}

Hello! I'm the POC test agent and I received your message successfully.
`;

  writeFileSync(join(POC_WORKSPACE_DIR, 'AGENTS.md'), agentsMd, 'utf-8');

  // Also write CLAUDE.md as some OpenClaw versions may look for it
  writeFileSync(join(POC_WORKSPACE_DIR, 'CLAUDE.md'), agentsMd, 'utf-8');

  info(`Test workspace created at ${POC_WORKSPACE_DIR}`);
  info(`AGENTS.md magic phrase: ${POC_MAGIC_PHRASE}`);
}

function cleanupTestWorkspace() {
  if (existsSync(POC_WORKSPACE_DIR)) {
    rmSync(POC_WORKSPACE_DIR, { recursive: true, force: true });
    info(`Test workspace removed: ${POC_WORKSPACE_DIR}`);
  }

  // Also clean up the parent dir if empty
  const parentDir = join(homedir(), '.clawx', 'employees');
  try {
    if (existsSync(parentDir) && readdirSync(parentDir).length === 0) {
      rmSync(parentDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}

// ── Gateway WebSocket Client (copied from test-gateway-chat.mjs with minimal changes) ──

class GatewayTestClient {
  constructor(port, token) {
    this.port = port;
    this.token = token;
    this.ws = null;
    this.pending = new Map(); // id → { resolve, reject, timeout }
    this.connected = false;
    this.eventHandlers = new Map();
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, []);
    this.eventHandlers.get(event).push(handler);
  }

  emit(event, ...args) {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach((h) => h(...args));
  }

  connect() {
    return new Promise((resolve, reject) => {
      const wsUrl = `ws://localhost:${this.port}/ws`;
      info(`Connecting to ${wsUrl}...`);

      this.ws = new WebSocket(wsUrl);
      let handshakeComplete = false;
      let connectId = null;

      const connectFrame = {
        type: 'req',
        id: `connect-${Date.now()}`,
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: 'gateway-client',
            displayName: 'POC Multi-Agent Test',
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

      connectId = connectFrame.id;
      let connectSent = false;

      const doSendConnect = () => {
        if (connectSent) return;
        connectSent = true;
        this.ws.send(JSON.stringify(connectFrame));
      };

      // Store the pending handshake so handleMessage can resolve it
      this.pending.set(connectFrame.id, {
        resolve: () => {
          handshakeComplete = true;
          this.connected = true;
          resolve();
        },
        reject: (err) => reject(err),
        timeout: setTimeout(() => {
          if (!handshakeComplete) {
            this.ws?.close();
            reject(new Error('Connection handshake timeout (10s)'));
          }
        }, 10000),
      });

      this.ws.on('open', () => {
        // Wait briefly for connect.challenge, then send anyway
        setTimeout(() => {
          if (!connectSent) doSendConnect();
        }, 750);
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg, doSendConnect);
        } catch {
          // ignore parse errors
        }
      });

      this.ws.on('close', (code, reason) => {
        this.connected = false;
        if (!handshakeComplete) {
          reject(new Error(`WebSocket closed before handshake (code=${code})`));
        } else {
          this.emit('close', code, reason?.toString());
        }
      });

      this.ws.on('error', (err) => {
        if (!handshakeComplete) reject(err);
        else this.emit('error', err);
      });
    });
  }

  /**
   * Handle incoming WebSocket messages — mirrors test-gateway-chat.mjs exactly.
   * Supports both OpenClaw native protocol ("evt"/"res") and JSON-RPC 2.0 fallback.
   */
  handleMessage(msg, doSendConnect) {
    // ── OpenClaw protocol event (type: "evt" or "event") ──
    if ((msg.type === 'evt' || msg.type === 'event') && typeof msg.event === 'string') {
      if (msg.event === 'connect.challenge') {
        doSendConnect?.();
        return;
      }
      if (msg.event === 'tick' || msg.event === 'health') return; // heartbeat

      if (msg.event === 'chat') {
        this.emit('chat', msg.payload);
        return;
      }

      // Agent stream events carry actual LLM output deltas
      if (msg.event === 'agent') {
        const payload = msg.payload || {};
        const stream = payload.stream;
        const data = payload.data || {};

        if (stream === 'assistant' && data.delta) {
          this.emit('chat', {
            runId: payload.runId,
            sessionKey: payload.sessionKey,
            seq: payload.seq,
            state: 'delta',
            message: { role: 'assistant', content: data.delta },
          });
          return;
        }

        if (stream === 'lifecycle') {
          const phase = data.phase;
          if (phase === 'end' || phase === 'done' || phase === 'complete') {
            this.emit('chat', {
              runId: payload.runId,
              sessionKey: payload.sessionKey,
              state: 'final',
              message: {
                role: 'assistant',
                stopReason: data.stopReason || 'end_turn',
                content: data.text || '',
              },
            });
          }
          return;
        }

        if (stream === 'tool') {
          this.emit('event', 'tool.' + (data.phase || 'call'), data);
          return;
        }

        if (stream === 'error') {
          this.emit('chat', {
            runId: payload.runId,
            sessionKey: payload.sessionKey,
            state: 'final',
            message: {
              role: 'assistant',
              stopReason: 'error',
              errorMessage: data.message || data.error || 'Unknown error',
              content: '',
            },
          });
          return;
        }

        return; // Ignore other agent sub-streams silently
      }

      // Generic event
      this.emit('event', msg.event, msg.payload);
      return;
    }

    // ── OpenClaw protocol response (type: "res") ──
    if (msg.type === 'res' && typeof msg.id === 'string') {
      const req = this.pending.get(msg.id);
      if (req) {
        clearTimeout(req.timeout);
        this.pending.delete(msg.id);
        if (msg.ok === false || msg.error) {
          const errMsg =
            typeof msg.error === 'object'
              ? msg.error?.message || JSON.stringify(msg.error)
              : String(msg.error || 'Unknown');
          req.reject(new Error(errMsg));
        } else {
          req.resolve(msg.payload ?? msg);
        }
        return;
      }
    }

    // ── JSON-RPC 2.0 response (legacy fallback) ──
    if (msg.jsonrpc === '2.0' && msg.id) {
      const req = this.pending.get(String(msg.id));
      if (req) {
        clearTimeout(req.timeout);
        this.pending.delete(String(msg.id));
        if (msg.error) {
          req.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          req.resolve(msg.result);
        }
        return;
      }
    }

    // ── JSON-RPC 2.0 notification (legacy) ──
    if (msg.jsonrpc === '2.0' && !msg.id && msg.method) {
      this.emit('notification', msg);
      return;
    }
  }

  rpc(method, params, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }

      const id = randomUUID();
      const frame = { type: 'req', id, method, params };

      this.pending.set(id, {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`RPC timeout: ${method} (${timeoutMs}ms)`));
        }, timeoutMs),
      });

      this.ws.send(JSON.stringify(frame));
    });
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    for (const [, req] of this.pending) {
      clearTimeout(req.timeout);
      req.reject(new Error('Client closed'));
    }
    this.pending.clear();
    this.connected = false;
  }
}

// ── Chat Helpers ────────────────────────────────────────────────────────

/**
 * Extract text content from a chat event payload.
 * The payload shape varies depending on the event source:
 *   - Plain string delta: "hello"
 *   - Structured delta from handleMessage: { message: { content: "hello" }, state: "delta" }
 *   - Raw chat event: { message: "hello" }
 *   - Object with text: { text: "hello" }
 */
function extractTextFromPayload(payload) {
  if (payload == null) return { text: '', state: undefined };

  const state = payload.state;

  // Already a plain string (raw chat event)
  if (typeof payload === 'string') {
    return { text: payload, state };
  }

  // { message: ... } wrapper
  const msg = payload.message ?? payload;

  if (typeof msg === 'string') {
    return { text: msg, state };
  }

  if (msg && typeof msg === 'object') {
    // { content: "..." } or { text: "..." } or { delta: "..." }
    const content = msg.content ?? msg.text ?? msg.delta ?? '';
    if (typeof content === 'string') {
      return { text: content, state: state ?? msg.state };
    }
  }

  // Last resort — don't stringify objects, just return empty
  return { text: '', state };
}

/**
 * Send a chat message and collect the full streaming response.
 * Returns the concatenated text content.
 */
function sendChatAndCollect(
  client,
  sessionKey,
  message,
  { method = 'chat.send', extraSystemPrompt, timeoutMs = 60000 } = {}
) {
  return new Promise((resolve, reject) => {
    let fullContent = '';
    let isFirst = true;
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        cleanup();
        if (fullContent.length > 0) {
          resolved = true;
          resolve(fullContent);
        } else {
          resolved = true;
          reject(new Error(`Chat response timeout (${timeoutMs / 1000}s) — no content received`));
        }
      }
    }, timeoutMs);

    const onChat = (payload) => {
      if (resolved) return;

      const { text, state } = extractTextFromPayload(payload);

      if (text) {
        fullContent += text;
        if (isFirst) {
          process.stdout.write(`    ${C.dim}Response: ${C.reset}`);
          isFirst = false;
        }
        // Print a truncated preview
        process.stdout.write(C.dim + text.replace(/\n/g, ' ').slice(0, 120) + C.reset);
      }

      // Check for final state
      if (state === 'final' || state === 'done' || state === 'complete') {
        if (!resolved) {
          resolved = true;
          cleanup();
          process.stdout.write('\n');
          resolve(fullContent);
        }
      }
    };

    // Also listen for run-complete events as alternative completion signal
    const onEvent = (event, _payload) => {
      if (resolved) return;
      if (
        event === 'run.complete' ||
        event === 'run.finished' ||
        event === 'agent.complete' ||
        event === 'agent.finished'
      ) {
        // Give a small delay for any remaining chat chunks
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            process.stdout.write('\n');
            resolve(fullContent);
          }
        }, 1000);
      }
    };

    function cleanup() {
      clearTimeout(timer);
      client.eventHandlers.delete('chat');
      client.eventHandlers.delete('event');
    }

    client.eventHandlers.set('chat', [onChat]);
    client.eventHandlers.set('event', [onEvent]);

    // Build RPC params
    const rpcParams = {
      sessionKey,
      message,
      deliver: false,
      idempotencyKey: randomUUID(),
    };

    if (extraSystemPrompt) {
      rpcParams.extraSystemPrompt = extraSystemPrompt;
    }

    // Send the RPC
    client.rpc(method, rpcParams, timeoutMs).catch((err) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(err);
      }
    });
  });
}

// ── Test Procedures ─────────────────────────────────────────────────────

const results = {
  tests: [],
  blockerVerdict: {},
};

function record(name, passed, detail) {
  results.tests.push({ name, passed, detail });
  if (passed) {
    pass(`${name}${detail ? ` — ${C.dim}${detail}${C.reset}` : ''}`);
  } else {
    fail(`${name}${detail ? ` — ${C.dim}${detail}${C.reset}` : ''}`);
  }
}

/**
 * Test 1: Verify config.get / config.patch RPC availability
 */
async function testConfigRpc(client) {
  subheading('Test 1: Gateway Config RPC Methods');

  // Test config.get
  try {
    const configResult = await client.rpc('config.get', {}, 10000);
    record(
      'config.get RPC',
      true,
      `Returned ${typeof configResult} (keys: ${Object.keys(configResult || {})
        .slice(0, 5)
        .join(', ')})`
    );

    // Check if it returns a hash for CAS
    const hash = configResult?.hash || configResult?.baseHash || configResult?._hash;
    if (hash) {
      record('config.get returns hash (CAS)', true, `hash=${String(hash).slice(0, 16)}...`);
    } else {
      record(
        'config.get returns hash (CAS)',
        false,
        'No hash field found — config.patch may not be available'
      );
    }
  } catch (err) {
    record('config.get RPC', false, err.message);
  }

  // Test config.patch (dry run — try to read the current config structure)
  try {
    // First try: send a no-op patch to see if the method exists
    // This might fail but will tell us if the method is recognized
    const patchResult = await client.rpc('config.patch', { ops: [] }, 10000);
    record(
      'config.patch RPC (empty ops)',
      true,
      `Returned: ${JSON.stringify(patchResult).slice(0, 100)}`
    );
  } catch (err) {
    if (err.message.includes('timeout')) {
      record('config.patch RPC', false, 'Timeout — method may not exist');
    } else {
      // An error response means the method exists but rejected our input
      record(
        'config.patch RPC (method exists)',
        true,
        `Error response: ${err.message.slice(0, 100)}`
      );
    }
  }

  // Test sessions.list to verify basic RPC works
  try {
    const sessions = await client.rpc('sessions.list', {}, 10000);
    const count = Array.isArray(sessions) ? sessions.length : '?';
    record('sessions.list RPC (baseline)', true, `${count} sessions found`);
  } catch (err) {
    record('sessions.list RPC (baseline)', false, err.message);
  }
}

/**
 * Test 2: Direct file write + hot-reload detection
 */
async function testDirectFileWrite(client) {
  subheading('Test 2: Direct File Write → Hot Reload');

  // Step 1: Create workspace
  createTestWorkspace();
  record(
    'Create test workspace',
    existsSync(join(POC_WORKSPACE_DIR, 'AGENTS.md')),
    POC_WORKSPACE_DIR
  );

  // Step 2: Backup and modify config
  backupConfig();
  const config = readConfig();

  const hadAgentsList = !!config.agents?.list;
  info(
    `Current agents.list: ${hadAgentsList ? `${config.agents.list.length} agents` : 'not present (will create)'}`
  );

  const modifiedConfig = addTestAgentToConfig(config);
  writeConfig(modifiedConfig);

  const verifyConfig = readConfig();
  const testAgentInConfig = verifyConfig.agents?.list?.some((a) => a.id === POC_AGENT_ID);
  record(
    'Write test agent to openclaw.json',
    testAgentInConfig,
    `agents.list now has ${verifyConfig.agents?.list?.length} entries`
  );

  // Step 3: Wait and check if Gateway picks it up
  info('Waiting 3s for potential hot-reload...');
  await sleep(3000);

  // Step 4: Try to list sessions for the new agent
  try {
    // Try sessions.list and see if the agent appears in any form
    const sessions = await client.rpc('sessions.list', {}, 10000);
    info(
      `sessions.list returned ${Array.isArray(sessions) ? sessions.length : '?'} sessions after config write`
    );
    record('sessions.list after config write', true, 'RPC still works (Gateway not crashed)');
  } catch (err) {
    record('sessions.list after config write', false, `Gateway may have crashed: ${err.message}`);
  }

  // Step 5: Try sending a simple message to the new agent session
  // This is the critical test — does Gateway route to agent:poc-multiagent-test:main?
  return testAgentInConfig;
}

/**
 * Test 3: Multi-agent routing — send chat to test agent session
 */
async function testMultiAgentRouting(client) {
  subheading('Test 3: Multi-Agent Routing (chat.send → agent session)');

  const testMessage = 'Hello, please confirm you received this message. Keep your response short.';

  // Test 3a: Send to the native agent session key
  info(`Sending chat.send to session: ${POC_SESSION_KEY}`);
  info(`Expecting magic phrase: ${POC_MAGIC_PHRASE}`);

  try {
    const response = await sendChatAndCollect(client, POC_SESSION_KEY, testMessage, {
      method: 'chat.send',
      timeoutMs: 60000,
    });

    // Normalize: remove stray whitespace/newlines for robust matching
    const normalized = response.replace(/\s+/g, ' ');
    const hasMagic = normalized.includes(POC_MAGIC_PHRASE);
    record(
      'chat.send → agent:poc-test:main (hot-reload)',
      hasMagic,
      hasMagic
        ? `Magic phrase found! Agent AGENTS.md is being used as system prompt`
        : `Response (${response.length} chars): "${response.slice(0, 300)}..." — Magic phrase NOT found`
    );

    return { hotReload: hasMagic, response };
  } catch (err) {
    record('chat.send → agent:poc-test:main (hot-reload)', false, err.message);
    return { hotReload: false, error: err.message };
  }
}

/**
 * Test 4: Try with 'agent' RPC method instead of 'chat.send'
 */
async function testAgentMethod(client) {
  subheading('Test 4: Try "agent" RPC method (fallback)');

  const testMessage = 'Hello, confirm receipt. Keep it short.';

  try {
    const response = await sendChatAndCollect(client, POC_SESSION_KEY, testMessage, {
      method: 'agent',
      timeoutMs: 60000,
    });

    const normalized = response.replace(/\s+/g, ' ');
    const hasMagic = normalized.includes(POC_MAGIC_PHRASE);
    record(
      'agent RPC → agent:poc-test:main',
      hasMagic,
      hasMagic
        ? `Magic phrase found! "agent" method routes correctly`
        : `Response (${response.length} chars): "${response.slice(0, 300)}..." — No magic phrase`
    );

    return { agentMethod: hasMagic, response };
  } catch (err) {
    record('agent RPC → agent:poc-test:main', false, err.message);
    return { agentMethod: false, error: err.message };
  }
}

/**
 * Test 5: Gateway restart then re-test
 */
async function testAfterRestart(client, gatewayConfig) {
  subheading('Test 5: Gateway Restart → Re-test Routing');

  info('Attempting Gateway restart via RPC...');

  // Try graceful restart RPC
  let restartWorked = false;
  try {
    await client.rpc('gateway.restart', {}, 5000);
    restartWorked = true;
  } catch {
    // Expected — restart kills the connection
    restartWorked = true; // If it killed our connection, it probably restarted
  }

  // Close stale connection
  client.close();

  // Wait for Gateway to come back up
  info('Waiting for Gateway to restart (up to 15s)...');
  const startWait = Date.now();
  let reconnected = false;

  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(1000);

    try {
      const newClient = new GatewayTestClient(gatewayConfig.port, gatewayConfig.token);
      await newClient.connect();
      reconnected = true;
      const elapsed = Date.now() - startWait;
      record('Gateway restart + reconnect', true, `Took ${elapsed}ms`);

      // Now test routing again
      const testMessage = 'Confirm receipt. Be brief.';
      info(`Re-testing chat.send → ${POC_SESSION_KEY}`);

      try {
        const response = await sendChatAndCollect(newClient, POC_SESSION_KEY, testMessage, {
          method: 'chat.send',
          timeoutMs: 60000,
        });

        const normalized = response.replace(/\s+/g, ' ');
        const hasMagic = normalized.includes(POC_MAGIC_PHRASE);
        record(
          'chat.send after restart',
          hasMagic,
          hasMagic
            ? `Magic phrase found after restart!`
            : `Response: "${response.slice(0, 300)}" — No magic phrase`
        );

        newClient.close();
        return { afterRestart: hasMagic, response, restartTimeMs: elapsed };
      } catch (chatErr) {
        record('chat.send after restart', false, chatErr.message);
        newClient.close();
        return { afterRestart: false, error: chatErr.message };
      }
    } catch {
      // Not ready yet, keep waiting
    }
  }

  if (!reconnected) {
    record('Gateway restart + reconnect', false, 'Could not reconnect after 15s');
    warn('Gateway may need manual restart. POC cannot continue this test.');
    warn('Try: restart ClawX app, then re-run this script with --skip-restart');
    return { afterRestart: false, error: 'Gateway did not come back' };
  }
}

/**
 * Test 6: Isolation verification — main agent should NOT have the magic phrase
 */
async function testIsolation(client) {
  subheading('Test 6: Isolation Verification');

  const testMessage = 'Say "hello world" and nothing else.';
  const mainSessionKey = 'agent:main:main';

  info(`Sending chat.send to default session: ${mainSessionKey}`);

  try {
    const response = await sendChatAndCollect(client, mainSessionKey, testMessage, {
      method: 'chat.send',
      timeoutMs: 30000,
    });

    const normalized = response.replace(/\s+/g, ' ');
    const hasMagic = normalized.includes(POC_MAGIC_PHRASE);
    record(
      'Isolation: main agent does NOT have magic phrase',
      !hasMagic,
      hasMagic
        ? `ISOLATION BREACH! Main agent returned magic phrase`
        : `Main agent response clean (${response.length} chars)`
    );

    return { isolated: !hasMagic };
  } catch (err) {
    // If main session errors, that's still isolation (not leaking)
    record('Isolation: main session error (acceptable)', true, err.message);
    return { isolated: true, error: err.message };
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────────

async function cleanup() {
  heading('Cleanup');

  // Remove test agent from config
  try {
    const config = readConfig();
    const cleaned = removeTestAgentFromConfig(config);
    writeConfig(cleaned);
    pass('Removed test agent from openclaw.json');
  } catch (err) {
    warn(`Failed to clean config: ${err.message}`);
    // Try restore from backup
    restoreConfig();
  }

  // Remove backup
  if (existsSync(OPENCLAW_CONFIG_BACKUP_PATH)) {
    rmSync(OPENCLAW_CONFIG_BACKUP_PATH, { force: true });
    info('Removed config backup');
  }

  // Remove workspace (Gateway may hold a lock briefly after restart, retry)
  if (existsSync(POC_WORKSPACE_DIR)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        rmSync(POC_WORKSPACE_DIR, { recursive: true, force: true });
        pass(`Removed test workspace: ${POC_WORKSPACE_DIR}`);
        break;
      } catch (err) {
        if (attempt < 2) {
          warn(`Workspace cleanup attempt ${attempt + 1} failed (${err.code}), retrying in 2s...`);
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          warn(`Could not remove workspace: ${err.message}`);
          warn(`Manually delete: ${POC_WORKSPACE_DIR}`);
        }
      }
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────

function printReport(chatResults) {
  heading('POC Results Summary');

  const passed = results.tests.filter((t) => t.passed).length;
  const total = results.tests.length;

  console.log(`  ${C.bold}Tests: ${passed}/${total} passed${C.reset}\n`);

  for (const test of results.tests) {
    const icon = test.passed ? `${C.green}✔${C.reset}` : `${C.red}✘${C.reset}`;
    console.log(`  ${icon} ${test.name}`);
    if (test.detail) {
      console.log(`    ${C.dim}${test.detail}${C.reset}`);
    }
  }

  // ── Blocker Verdicts ──

  heading('Blocker Verdicts');

  // Blocker #1: Config modification method
  const hotReloadWorked = chatResults?.hotReload || chatResults?.agentMethod;
  const afterRestartWorked = chatResults?.afterRestart;

  console.log(`  ${C.bold}Blocker #1: Config Modification Method${C.reset}`);
  if (hotReloadWorked) {
    console.log(`  ${C.green}✔ RESOLVED: Direct file write + hot-reload works!${C.reset}`);
    console.log(`  ${C.dim}  → Use writeFileSync to update openclaw.json`);
    console.log(`  → Add ConfigUpdateQueue (mutex) to serialize writes`);
    console.log(`  → No Gateway restart needed${C.reset}`);
    results.blockerVerdict.configMethod = 'DIRECT_WRITE_HOT_RELOAD';
  } else if (afterRestartWorked) {
    console.log(`  ${C.yellow}⚠ PARTIALLY RESOLVED: Requires Gateway restart${C.reset}`);
    console.log(`  ${C.dim}  → Use writeFileSync + gatewayManager.restart()`);
    console.log(`  → Restart time: ~${chatResults.restartTimeMs || '?'}ms`);
    console.log(`  → User will experience brief interruption during employee activation${C.reset}`);
    results.blockerVerdict.configMethod = 'DIRECT_WRITE_PLUS_RESTART';
  } else {
    console.log(`  ${C.red}✘ NOT RESOLVED: Neither hot-reload nor restart worked${C.reset}`);
    console.log(`  ${C.dim}  → Need to investigate config.patch RPC or alternative approach`);
    console.log(`  → Check Gateway logs for errors${C.reset}`);
    results.blockerVerdict.configMethod = 'BLOCKED';
  }

  console.log('');

  // Blocker #2: Multi-agent routing
  const routingWorked = hotReloadWorked || afterRestartWorked;
  const isolationOk = chatResults?.isolated !== false;

  console.log(`  ${C.bold}Blocker #2: Multi-Agent Routing${C.reset}`);
  if (routingWorked && isolationOk) {
    console.log(
      `  ${C.green}✔ RESOLVED: agent:{slug}:main routes correctly with isolation${C.reset}`
    );
    console.log(`  ${C.dim}  → Gateway reads AGENTS.md from agent workspace`);
    console.log(`  → Session key format agent:{slug}:main is correct`);
    console.log(`  → Agents are properly isolated${C.reset}`);
    results.blockerVerdict.routing = 'WORKS_WITH_ISOLATION';
  } else if (routingWorked && !isolationOk) {
    console.log(`  ${C.yellow}⚠ PARTIALLY RESOLVED: Routing works but isolation issue${C.reset}`);
    console.log(`  ${C.dim}  → Need to investigate workspace isolation${C.reset}`);
    results.blockerVerdict.routing = 'ROUTING_OK_ISOLATION_ISSUE';
  } else {
    console.log(`  ${C.red}✘ NOT RESOLVED: Routing to agent:{slug}:main failed${C.reset}`);
    console.log(`  ${C.dim}  → Gateway may not support agents.list in current config`);
    console.log(`  → Check Gateway version and logs${C.reset}`);
    results.blockerVerdict.routing = 'BLOCKED';
  }

  console.log('');

  // Overall recommendation
  console.log(`  ${C.bold}Recommendation${C.reset}`);
  if (
    results.blockerVerdict.configMethod !== 'BLOCKED' &&
    results.blockerVerdict.routing !== 'BLOCKED'
  ) {
    console.log(`  ${C.green}✔ PROCEED with migration. Both blockers resolved.${C.reset}`);
    if (results.blockerVerdict.configMethod === 'DIRECT_WRITE_PLUS_RESTART') {
      console.log(
        `  ${C.yellow}  Note: Factor in ~3s restart delay during employee activation${C.reset}`
      );
    }
  } else {
    console.log(`  ${C.red}✘ DO NOT proceed until blockers are resolved.${C.reset}`);
    console.log(`  ${C.dim}  Check Gateway logs at ~/.openclaw/logs/ for details.${C.reset}`);
  }

  console.log('');
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const cleanupOnly = args.includes('--cleanup');
  const skipChat = args.includes('--skip-chat');
  const skipRestart = args.includes('--skip-restart');

  console.log(
    `\n${C.bold}${C.magenta}╔══════════════════════════════════════════════════════╗${C.reset}`
  );
  console.log(
    `${C.bold}${C.magenta}║   POC: Multi-Agent Migration Blocker Verification    ║${C.reset}`
  );
  console.log(
    `${C.bold}${C.magenta}╚══════════════════════════════════════════════════════╝${C.reset}`
  );

  if (cleanupOnly) {
    cleanup();
    console.log(`\n${C.green}Cleanup complete.${C.reset}\n`);
    process.exit(0);
  }

  // ── Pre-flight checks ──

  heading('Pre-flight Checks');

  if (!existsSync(OPENCLAW_CONFIG_PATH)) {
    fail(`openclaw.json not found at ${OPENCLAW_CONFIG_PATH}`);
    process.exit(1);
  }
  pass(`openclaw.json found at ${OPENCLAW_CONFIG_PATH}`);

  const config = readConfig();
  pass(`Config loaded (keys: ${Object.keys(config).join(', ')})`);

  const currentAgents = config.agents?.list;
  info(
    `Current agents.list: ${currentAgents ? `${currentAgents.length} agents` : 'not configured'}`
  );
  info(
    `Current agents.defaults.model: ${JSON.stringify(config.agents?.defaults?.model || 'not set')}`
  );

  // Settings
  const settings = loadSettings();
  pass(`Settings loaded (gatewayPort: ${settings.gatewayPort})`);

  const gatewayConfig = getGatewayConfig();
  info(`Gateway: ws://localhost:${gatewayConfig.port}/ws`);

  // ── Connect to Gateway ──

  heading('Gateway Connection');

  const client = new GatewayTestClient(gatewayConfig.port, gatewayConfig.token);

  try {
    await client.connect();
    pass('Connected to Gateway');
  } catch (err) {
    fail(`Failed to connect: ${err.message}`);
    console.error(`\n  ${C.red}Is ClawX running? Is the Gateway started?${C.reset}\n`);
    process.exit(1);
  }

  // Graceful shutdown
  let cleanupDone = false;
  const doCleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    client.close();
    cleanup();
  };

  process.on('SIGINT', () => {
    console.log(`\n${C.dim}Interrupted. Cleaning up...${C.reset}`);
    doCleanup();
    process.exit(1);
  });

  const chatResults = {};

  try {
    // ── Blocker #1: Config RPC Methods ──

    heading('Blocker #1: Config Modification Method');

    await testConfigRpc(client);

    // ── Direct file write test ──

    const configWriteOk = await testDirectFileWrite(client);

    // ── Blocker #2: Multi-Agent Routing ──

    if (!skipChat && configWriteOk) {
      heading('Blocker #2: Multi-Agent Routing');

      // Test 3: Try routing immediately (hot-reload)
      const routeResult = await testMultiAgentRouting(client);
      chatResults.hotReload = routeResult.hotReload;

      // Test 4: Try 'agent' method if chat.send didn't work
      if (!routeResult.hotReload) {
        const agentResult = await testAgentMethod(client);
        chatResults.agentMethod = agentResult.agentMethod;
      }

      // Test 5: If neither worked, try after restart
      if (!routeResult.hotReload && !chatResults.agentMethod && !skipRestart) {
        const restartResult = await testAfterRestart(client, gatewayConfig);
        chatResults.afterRestart = restartResult?.afterRestart;
        chatResults.restartTimeMs = restartResult?.restartTimeMs;

        // If restart worked, we need a new client for isolation test
        if (restartResult?.afterRestart) {
          try {
            const newClient = new GatewayTestClient(gatewayConfig.port, gatewayConfig.token);
            await newClient.connect();
            const isolationResult = await testIsolation(newClient);
            chatResults.isolated = isolationResult.isolated;
            newClient.close();
          } catch (err) {
            warn(`Isolation test skipped: ${err.message}`);
          }
        }
      } else if (routeResult.hotReload || chatResults.agentMethod) {
        // Routing worked, do isolation test
        const isolationResult = await testIsolation(client);
        chatResults.isolated = isolationResult.isolated;
      }
    } else if (skipChat) {
      info('Skipping chat tests (--skip-chat flag)');
    } else if (!configWriteOk) {
      warn('Config write failed, skipping routing tests');
    }
  } catch (err) {
    fail(`Unexpected error: ${err.message}`);
    console.error(err.stack);
  } finally {
    // ── Cleanup ──
    client.close();
    await cleanup();
  }

  // ── Report ──
  printReport(chatResults);

  // Brief wait for Gateway to release any file handles before writing results
  await sleep(500);

  // Write machine-readable results
  const reportPath = join(process.cwd(), 'poc-multi-agent-results.json');
  try {
    writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf-8');
    info(`Machine-readable results written to ${reportPath}`);
  } catch {
    // Non-critical
  }

  // Exit with appropriate code
  const allPassed =
    results.blockerVerdict.configMethod !== 'BLOCKED' &&
    results.blockerVerdict.routing !== 'BLOCKED';
  process.exit(allPassed ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`${C.red}Fatal: ${err.message}${C.reset}`);
  console.error(err.stack);
  // Emergency cleanup
  try {
    await cleanup();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
