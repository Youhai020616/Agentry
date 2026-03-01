#!/usr/bin/env node
/**
 * test-gateway-chat.mjs
 *
 * Terminal-based test script for sending prompts to AI employees via the Gateway WebSocket.
 * Connects directly to the OpenClaw Gateway, performs the protocol handshake, and sends
 * a chat message using the `agent` RPC method (with system prompt injection).
 *
 * Usage:
 *   node scripts/test-gateway-chat.mjs "你好，帮我看看 github.com/trending 今天有什么热门项目"
 *   node scripts/test-gateway-chat.mjs --employee browser-agent "打开 example.com 看看标题"
 *   node scripts/test-gateway-chat.mjs --employee supervisor "帮我看看 notion 的定价方案"
 *   node scripts/test-gateway-chat.mjs --list-employees
 *   node scripts/test-gateway-chat.mjs --interactive
 *   node scripts/test-gateway-chat.mjs --interactive --employee browser-agent
 *
 * Prerequisites:
 *   - ClawX app must be running (Gateway process must be active)
 *   - The target employee must be activated in the Employee Hub
 *
 * Environment:
 *   GATEWAY_PORT  — Override Gateway port (default: reads from settings or 18789)
 *   GATEWAY_TOKEN — Override Gateway token (default: reads from settings.json)
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

// ── Configuration ──────────────────────────────────────────────────────

const APPDATA = process.env.APPDATA || join(homedir(), '.config');
const SETTINGS_PATH = join(APPDATA, 'pocketcrow', 'settings.json');
const EMPLOYEES_DIR = join(process.cwd(), 'resources', 'employees');

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

// ── Helpers ────────────────────────────────────────────────────────────

function loadSettings() {
  if (!existsSync(SETTINGS_PATH)) {
    console.error(`${C.red}✗ Settings file not found: ${SETTINGS_PATH}${C.reset}`);
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

function loadEmployeeManifest(slug) {
  const manifestPath = join(EMPLOYEES_DIR, slug, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

function loadEmployeeSkillMd(slug) {
  const skillPath = join(EMPLOYEES_DIR, slug, 'SKILL.md');
  if (!existsSync(skillPath)) return null;
  return readFileSync(skillPath, 'utf-8');
}

function listAvailableEmployees() {
  if (!existsSync(EMPLOYEES_DIR)) return [];
  return readdirSync(EMPLOYEES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const manifest = loadEmployeeManifest(d.name);
      return manifest ? { slug: d.name, ...manifest } : null;
    })
    .filter(Boolean);
}

/**
 * Compile a basic system prompt from manifest + SKILL.md
 * Replicates the compiler's template variable substitution.
 *
 * NOTE: Gateway-native tools (e.g. `browser`) are provided by the Gateway's
 * own tool schema — we do NOT inject exec-wrapper prompts. The employee's
 * SKILL.md contains behavioral guidance that complements the native tool.
 */
function compileSystemPrompt(slug) {
  const manifest = loadEmployeeManifest(slug);
  if (!manifest) return null;

  let template = loadEmployeeSkillMd(slug);
  if (!template) {
    // Generate a basic prompt from manifest
    const emp = manifest.employee;
    return `You are ${emp.role} (${emp.roleZh}), team ${emp.team}.\n\nYour working style is: ${emp.personality.style}\n`;
  }

  const emp = manifest.employee;
  template = template.replace(/\{\{ROLE\}\}/g, emp.role || '');
  template = template.replace(/\{\{ROLE_ZH\}\}/g, emp.roleZh || '');
  template = template.replace(/\{\{TEAM\}\}/g, emp.team || '');
  template = template.replace(/\{\{PERSONALITY_STYLE\}\}/g, emp.personality?.style || '');
  template = template.replace(/\{\{SKILL_DIR\}\}/g, join(EMPLOYEES_DIR, slug));

  // Replace {{TEAM_ROSTER}} with all employees (for supervisor)
  if (template.includes('{{TEAM_ROSTER}}')) {
    const employees = listAvailableEmployees().filter((e) => e.slug !== slug);
    const roster = employees
      .map(
        (e) =>
          `- **${e.employee.role}** (${e.employee.roleZh}): slug=\`${e.slug}\`, team=${e.employee.team}, status=idle`
      )
      .join('\n');
    template = template.replace(/\{\{TEAM_ROSTER\}\}/g, roster || '(No employees available)');
  }

  return template;
}

// ── Gateway WebSocket Client ───────────────────────────────────────────

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
      console.log(`${C.dim}Connecting to ${wsUrl}...${C.reset}`);

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
            displayName: 'ClawX Test CLI',
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

      // Store the pending handshake
      this.pending.set(connectId, {
        resolve: () => {
          handshakeComplete = true;
          this.connected = true;
          resolve();
        },
        reject: (err) => reject(err),
        timeout: setTimeout(() => {
          if (!handshakeComplete) {
            this.ws.close();
            reject(new Error('Connect handshake timeout (10s)'));
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

  handleMessage(msg, doSendConnect) {
    // OpenClaw protocol event — both "evt" and "event" type formats
    if ((msg.type === 'evt' || msg.type === 'event') && typeof msg.event === 'string') {
      if (msg.event === 'connect.challenge') {
        doSendConnect?.();
        return;
      }
      if (msg.event === 'tick' || msg.event === 'health') return; // heartbeat / health (silent)

      if (msg.event === 'chat') {
        this.emit('chat', msg.payload);
        return;
      }

      // Agent stream events carry the actual LLM output deltas
      if (msg.event === 'agent') {
        const payload = msg.payload || {};
        const stream = payload.stream;
        const data = payload.data || {};

        if (stream === 'assistant' && data.delta) {
          // Emit as chat event with a shape our renderer understands
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

        // Tool call events from agent stream
        if (stream === 'tool') {
          this.emit('event', 'tool.' + (data.phase || 'call'), data);
          return;
        }

        // Other agent streams (e.g., 'error')
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

    // OpenClaw protocol response (res)
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

    // JSON-RPC 2.0 response (legacy)
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

    // JSON-RPC 2.0 notification
    if (msg.jsonrpc === '2.0' && !msg.id && msg.method) {
      this.emit('notification', msg);
      return;
    }
  }

  /**
   * Send an RPC request and wait for the response.
   * Note: For chat, the "response" just acknowledges the request (returns runId).
   * The actual LLM output comes via streaming 'chat' events.
   */
  rpc(method, params, timeoutMs = 60000) {
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
    for (const [id, req] of this.pending) {
      clearTimeout(req.timeout);
      req.reject(new Error('Client closed'));
    }
    this.pending.clear();
  }
}

// ── Chat Event Rendering ──────────────────────────────────────────────

/**
 * Renders streaming chat events to the terminal.
 * Returns a promise that resolves when the LLM response is complete.
 */
function waitForResponse(client, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    let fullContent = '';
    let isFirstChunk = true;
    let toolCallsInProgress = 0;

    const timer = setTimeout(() => {
      cleanup();
      if (fullContent) {
        // If we got content but timed out waiting for final event, still resolve
        process.stdout.write(`${C.reset}\n`);
        resolve(fullContent);
      } else {
        reject(new Error(`Response timeout (${timeout / 1000}s)`));
      }
    }, timeout);

    const onChat = (payload) => {
      if (!payload) return;

      // The payload can be the message directly or wrapped in { message: ... }
      const msg = payload.message || payload;
      const state = payload.state; // 'delta' or 'final'

      if (typeof msg === 'string') {
        // Plain text chunk (delta from agent stream)
        if (isFirstChunk) {
          process.stdout.write(`\n${C.green}${C.bold}Assistant: ${C.reset}${C.green}`);
          isFirstChunk = false;
        }
        process.stdout.write(msg);
        fullContent += msg;

        if (state === 'final') {
          process.stdout.write(`${C.reset}\n`);
          cleanup();
          resolve(fullContent);
        }
        return;
      }

      if (typeof msg !== 'object') return;

      // Extract text content from different message shapes
      let textDelta = '';
      const content = msg.content;
      if (typeof content === 'string') {
        textDelta = content;
      } else if (Array.isArray(content)) {
        // content: [{ type: "text", text: "..." }]
        textDelta = content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text)
          .join('');
      } else {
        textDelta = msg.text ?? msg.delta ?? '';
      }

      const stopReason = msg.stopReason ?? msg.stop_reason;
      const toolCalls = msg.toolCalls ?? msg.tool_calls;

      // Tool call events
      if (toolCalls && Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
          const status = tc.status || 'unknown';
          const name = tc.name || tc.function?.name || 'unknown';
          if (status === 'running' || status === 'pending') {
            toolCallsInProgress++;
            process.stdout.write(
              `\n${C.cyan}  ⚙ Tool call: ${name}${tc.arguments ? ` ${C.dim}${JSON.stringify(tc.arguments).slice(0, 120)}${C.reset}${C.cyan}` : ''}${C.reset}\n`
            );
          } else if (status === 'completed') {
            toolCallsInProgress = Math.max(0, toolCallsInProgress - 1);
            const resultStr =
              typeof tc.result === 'string'
                ? tc.result.slice(0, 200)
                : (JSON.stringify(tc.result)?.slice(0, 200) ?? '');
            process.stdout.write(
              `${C.cyan}  ✓ ${name} completed ${C.dim}(${tc.duration ?? '?'}ms)${C.reset}\n`
            );
            if (resultStr) {
              process.stdout.write(
                `${C.gray}    ${resultStr}${resultStr.length >= 200 ? '…' : ''}${C.reset}\n`
              );
            }
          } else if (status === 'error') {
            toolCallsInProgress = Math.max(0, toolCallsInProgress - 1);
            process.stdout.write(
              `${C.red}  ✗ ${name} failed: ${tc.error || 'unknown'}${C.reset}\n`
            );
          }
        }
      }

      // For delta events from the chat stream, we already get the full accumulated text.
      // We need to compute the actual delta by comparing with what we've already printed.
      if (state === 'delta' && textDelta) {
        // The chat event's text is cumulative. Compute the new portion.
        if (textDelta.length > fullContent.length && textDelta.startsWith(fullContent)) {
          const newPart = textDelta.slice(fullContent.length);
          if (newPart) {
            if (isFirstChunk) {
              process.stdout.write(`\n${C.green}${C.bold}Assistant: ${C.reset}${C.green}`);
              isFirstChunk = false;
            }
            process.stdout.write(newPart);
            fullContent = textDelta;
          }
        } else if (!fullContent && textDelta) {
          // First chunk
          if (isFirstChunk) {
            process.stdout.write(`\n${C.green}${C.bold}Assistant: ${C.reset}${C.green}`);
            isFirstChunk = false;
          }
          process.stdout.write(textDelta);
          fullContent = textDelta;
        }
        // If textDelta doesn't start with fullContent, it might be a non-cumulative delta
        else if (textDelta && !fullContent.endsWith(textDelta)) {
          if (isFirstChunk) {
            process.stdout.write(`\n${C.green}${C.bold}Assistant: ${C.reset}${C.green}`);
            isFirstChunk = false;
          }
          process.stdout.write(textDelta);
          fullContent += textDelta;
        }
      } else if (!state && textDelta) {
        // No state field — treat as incremental delta
        if (isFirstChunk) {
          process.stdout.write(`\n${C.green}${C.bold}Assistant: ${C.reset}${C.green}`);
          isFirstChunk = false;
        }
        process.stdout.write(textDelta);
        fullContent += textDelta;
      }

      // Check for completion
      if (stopReason || state === 'final') {
        process.stdout.write(`${C.reset}\n`);
        if (stopReason === 'error') {
          process.stdout.write(
            `${C.red}  Error: ${msg.errorMessage || msg.error || 'Unknown error'}${C.reset}\n`
          );
        }
        cleanup();
        resolve(fullContent);
      }
    };

    const onEvent = (event, payload) => {
      // Handle tool-related notifications
      if (event === 'tool.call_started' || event === 'tool_call_started') {
        const p = payload || {};
        const name = p.name || p.tool || 'unknown';
        const args = p.args || p.arguments || p.command || '';
        process.stdout.write(
          `\n${C.cyan}  ⚙ [${event}] ${name} ${C.dim}${typeof args === 'string' ? args.slice(0, 120) : JSON.stringify(args).slice(0, 120)}${C.reset}\n`
        );
      } else if (event === 'tool.call_completed' || event === 'tool_call_completed') {
        const p = payload || {};
        const name = p.name || p.tool || 'unknown';
        process.stdout.write(`${C.cyan}  ✓ [${event}] ${name} completed${C.reset}\n`);
      }
    };

    const onNotification = (notification) => {
      const method = notification.method || '';
      if (method.includes('tool')) {
        process.stdout.write(
          `${C.gray}  [notification] ${method}: ${JSON.stringify(notification.params).slice(0, 150)}${C.reset}\n`
        );
      }
    };

    function cleanup() {
      clearTimeout(timer);
      client.eventHandlers.delete('chat');
      client.eventHandlers.delete('event');
      client.eventHandlers.delete('notification');
    }

    // Reset handlers for this response
    client.eventHandlers.set('chat', [onChat]);
    client.eventHandlers.set('event', [onEvent]);
    client.eventHandlers.set('notification', [onNotification]);
  });
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  let employeeSlug = 'supervisor';
  let interactive = false;
  let listMode = false;
  const messageArgs = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--employee' || args[i] === '-e') {
      employeeSlug = args[++i];
    } else if (args[i] === '--interactive' || args[i] === '-i') {
      interactive = true;
    } else if (args[i] === '--list-employees' || args[i] === '--list') {
      listMode = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printHelp();
      process.exit(0);
    } else {
      messageArgs.push(args[i]);
    }
  }

  // List employees mode
  if (listMode) {
    const employees = listAvailableEmployees();
    console.log(`\n${C.bold}Available Employees:${C.reset}\n`);
    for (const emp of employees) {
      const tools = (emp.tools || []).map((t) => t.name).join(', ') || 'none';
      console.log(
        `  ${C.cyan}${emp.employee.avatar}${C.reset} ${C.bold}${emp.slug}${C.reset} — ${emp.employee.role} (${emp.employee.roleZh})`
      );
      console.log(`     ${C.dim}team: ${emp.employee.team}, tools: [${tools}]${C.reset}`);
    }
    console.log('');
    process.exit(0);
  }

  const message = messageArgs.join(' ');

  if (!message && !interactive) {
    printHelp();
    process.exit(1);
  }

  // Load employee info
  const manifest = loadEmployeeManifest(employeeSlug);
  if (!manifest) {
    console.error(`${C.red}✗ Employee '${employeeSlug}' not found in ${EMPLOYEES_DIR}${C.reset}`);
    const employees = listAvailableEmployees();
    console.error(`  Available: ${employees.map((e) => e.slug).join(', ')}`);
    process.exit(1);
  }

  const systemPrompt = compileSystemPrompt(employeeSlug);
  const sessionKey = `agent:${employeeSlug}:main`;

  console.log(`\n${C.bold}╔══════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}║   ClawX Gateway Chat Test                ║${C.reset}`);
  console.log(`${C.bold}╚══════════════════════════════════════════╝${C.reset}`);
  console.log(
    `${C.dim}  Employee:    ${C.reset}${manifest.employee.avatar}  ${manifest.employee.role} (${employeeSlug})`
  );
  console.log(`${C.dim}  Session:     ${C.reset}${sessionKey}`);
  console.log(
    `${C.dim}  Tools:       ${C.reset}${(manifest.tools || []).map((t) => t.name).join(', ') || 'none'}`
  );
  console.log(
    `${C.dim}  Prompt:      ${C.reset}${systemPrompt ? `${systemPrompt.length} chars` : 'none (will use gateway default)'}`
  );

  // Connect to Gateway
  const { port, token } = getGatewayConfig();
  console.log(`${C.dim}  Gateway:     ${C.reset}ws://localhost:${port}/ws`);
  console.log('');

  const client = new GatewayTestClient(port, token);

  try {
    await client.connect();
    console.log(`${C.green}✓ Connected to Gateway${C.reset}\n`);
  } catch (err) {
    console.error(`${C.red}✗ Failed to connect: ${err.message}${C.reset}`);
    console.error(`  Is ClawX running? Is the Gateway started?`);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log(`\n${C.dim}Disconnecting...${C.reset}`);
    client.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (interactive) {
    await runInteractive(client, employeeSlug, sessionKey, systemPrompt);
  } else {
    await sendAndWait(client, employeeSlug, sessionKey, systemPrompt, message);
    client.close();
  }
}

async function sendAndWait(client, employeeSlug, sessionKey, systemPrompt, message) {
  console.log(`${C.blue}${C.bold}You: ${C.reset}${message}\n`);

  // Build RPC params
  const rpcParams = {
    sessionKey,
    message,
    deliver: false,
    idempotencyKey: randomUUID(),
  };

  if (systemPrompt) {
    rpcParams.extraSystemPrompt = systemPrompt;
  }

  // Use 'agent' method (supports extraSystemPrompt) — this is what the IPC handler upgrades to
  const rpcMethod = systemPrompt ? 'agent' : 'chat.send';

  try {
    // Start listening for streaming response BEFORE sending
    const responsePromise = waitForResponse(client, { timeout: 180000 });

    // Send the RPC call
    const result = await client.rpc(rpcMethod, rpcParams, 60000);
    const runId = result?.runId;
    if (runId) {
      process.stdout.write(`${C.dim}  (runId: ${runId})${C.reset}`);
    }

    // Wait for the streaming response to complete
    const fullResponse = await responsePromise;

    console.log(`\n${C.dim}──────────────────────────────────────────${C.reset}`);
    console.log(`${C.dim}Response: ${fullResponse.length} chars${C.reset}`);
  } catch (err) {
    console.error(`\n${C.red}✗ Error: ${err.message}${C.reset}`);

    if (err.message.includes('session') || err.message.includes('Session')) {
      console.error(
        `\n${C.yellow}Hint: The employee "${employeeSlug}" may not be activated in ClawX.`
      );
      console.error(`Open ClawX → Employees → click the ▶ button to activate.${C.reset}`);
    }
    if (err.message.includes('model') || err.message.includes('provider')) {
      console.error(
        `\n${C.yellow}Hint: No LLM provider configured. Set up a provider in ClawX → Settings.${C.reset}`
      );
    }
  }
}

async function runInteractive(client, employeeSlug, sessionKey, systemPrompt) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${C.blue}You> ${C.reset}`,
  });

  console.log(`${C.dim}Interactive mode. Type your message and press Enter.`);
  console.log(`Commands: /quit, /switch <employee>, /status, /clear${C.reset}\n`);

  let currentSlug = employeeSlug;
  let currentSessionKey = sessionKey;
  let currentPrompt = systemPrompt;

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    // Handle commands
    if (input === '/quit' || input === '/exit' || input === '/q') {
      console.log(`${C.dim}Bye!${C.reset}`);
      client.close();
      process.exit(0);
    }

    if (input === '/status') {
      console.log(`${C.dim}  Employee: ${currentSlug}`);
      console.log(`  Session:  ${currentSessionKey}`);
      console.log(`  Prompt:   ${currentPrompt?.length ?? 0} chars${C.reset}\n`);
      rl.prompt();
      return;
    }

    if (input.startsWith('/switch ')) {
      const newSlug = input.slice(8).trim();
      const newManifest = loadEmployeeManifest(newSlug);
      if (!newManifest) {
        console.log(`${C.red}Employee '${newSlug}' not found.${C.reset}`);
        const employees = listAvailableEmployees();
        console.log(`${C.dim}Available: ${employees.map((e) => e.slug).join(', ')}${C.reset}\n`);
      } else {
        currentSlug = newSlug;
        currentSessionKey = `agent:main:employee-${newSlug}`;
        currentPrompt = compileSystemPrompt(newSlug);
        console.log(
          `${C.green}Switched to ${newManifest.employee.avatar} ${newManifest.employee.role} (${newSlug})${C.reset}\n`
        );
      }
      rl.prompt();
      return;
    }

    if (input === '/clear') {
      console.clear();
      rl.prompt();
      return;
    }

    // Send message
    console.log('');
    await sendAndWait(client, currentSlug, currentSessionKey, currentPrompt, input);
    console.log('');
    rl.prompt();
  });

  rl.on('close', () => {
    console.log(`\n${C.dim}Bye!${C.reset}`);
    client.close();
    process.exit(0);
  });
}

function printHelp() {
  console.log(`
${C.bold}ClawX Gateway Chat Test${C.reset}

${C.bold}Usage:${C.reset}
  node scripts/test-gateway-chat.mjs [options] "<message>"

${C.bold}Options:${C.reset}
  -e, --employee <slug>   Target employee (default: supervisor)
  -i, --interactive       Interactive chat mode
      --list-employees    List all available employees
  -h, --help              Show this help

${C.bold}Examples:${C.reset}
  ${C.dim}# Send a one-shot message to the supervisor${C.reset}
  node scripts/test-gateway-chat.mjs "你好，介绍一下你的团队"

  ${C.dim}# Chat with the browser agent${C.reset}
  node scripts/test-gateway-chat.mjs -e browser-agent "打开 github.com/trending"

  ${C.dim}# Interactive mode with supervisor${C.reset}
  node scripts/test-gateway-chat.mjs -i

  ${C.dim}# Interactive mode with browser agent${C.reset}
  node scripts/test-gateway-chat.mjs -i -e browser-agent

  ${C.dim}# List employees${C.reset}
  node scripts/test-gateway-chat.mjs --list

${C.bold}Prerequisites:${C.reset}
  - ClawX must be running (Gateway process active)
  - Target employee must be activated in Employee Hub
  - At least one LLM provider must be configured

${C.bold}Environment:${C.reset}
  GATEWAY_PORT   Override Gateway port (default: from settings or 18789)
  GATEWAY_TOKEN  Override Gateway token (default: from settings.json)
`);
}

main().catch((err) => {
  console.error(`${C.red}Fatal: ${err.message}${C.reset}`);
  process.exit(1);
});
